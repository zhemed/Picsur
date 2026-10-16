#!/usr/bin/env node
/**
 * Generates the image fixtures used by `support/regression-image-api.sh`.
 *
 * Why this script exists: the regression has to be reproducible on a fresh
 * checkout. The fixtures are 8 small images (one per supported source format)
 * plus one crafted "900 megapixel" PNG for the pixel-limit case. Sharp's
 * *prebuilt* libvips cannot encode JXL/JP2 (and, on some hosts, AVIF), so when
 * the local library is not enough the fixtures are generated inside a
 * container that ships the self compiled libvips.
 *
 * Usage:
 *   node support/make-image-fixtures.cjs [output-dir]
 *
 *   output-dir   defaults to $PICSUR_FIXTURES, else /tmp/bugs-fx
 *
 * Environment:
 *   PICSUR_FIXTURE_IMAGE     container image for the fallback
 *                            (default ghcr.io/zhemed/picsur:allinone)
 *   PICSUR_FIXTURE_NO_PULL   set to 1 to never pull an image (offline hosts)
 *   PICSUR_NODE_MODULES      node_modules dir containing sharp / qoi-img
 *                            (auto detected: <repo>/backend/node_modules,
 *                             /picsur/backend/node_modules, <cwd>/...)
 *
 * Exit code 0 = every fixture is in place, 1 = could not produce them.
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { execFileSync } = require('child_process');

const DEFAULT_IMAGE = 'ghcr.io/zhemed/picsur:allinone';
const BIG_FIXTURE = 'big-900mp.png'; // 30000x30000 = 900_000_000 pixels
const BIG_SIZE = 30000;
const IMAGE_SIZE = { width: 200, height: 150 };

// Fixture formats the regression uploads / transcodes. `qoi` comes from
// qoi-img, the rest from sharp.
const ALL_FORMATS = ['png', 'jpg', 'webp', 'avif', 'jxl', 'jp2', 'heif', 'qoi'];

const QUIET = process.argv.includes('--quiet');
const log = (...args) => {
  if (!QUIET) console.log(...args);
};
const fail = (...args) => console.error(...args);

// ---------------------------------------------------------------------------
// module resolution
// ---------------------------------------------------------------------------

/**
 * Node resolves `require()` relative to this file, and this file lives in
 * `support/` where there is no node_modules. Look explicitly at the places the
 * backend dependencies can be: the repo, the container image, the cwd.
 */
function resolveModulesDir() {
  const candidates = [
    process.env.PICSUR_NODE_MODULES,
    path.resolve(__dirname, '..', 'backend', 'node_modules'),
    '/picsur/backend/node_modules',
    path.resolve(process.cwd(), 'backend', 'node_modules'),
    path.resolve(process.cwd(), 'node_modules'),
  ].filter(Boolean);

  return candidates.find((dir) => fs.existsSync(path.join(dir, 'sharp'))) ?? null;
}

const loadModule = (dir, name) => require(require.resolve(name, { paths: [dir] }));

// ---------------------------------------------------------------------------
// oversize fixture (no image library needed, so it always works)
// ---------------------------------------------------------------------------

let crcTable = null;
function crc32(buf) {
  if (typeof zlib.crc32 === 'function') return zlib.crc32(buf);
  if (!crcTable) {
    crcTable = [];
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (const byte of buf) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/**
 * A PNG whose header claims 30000x30000 pixels. Sharp only reads the header
 * before the pixel limit check rejects it, so the file stays tiny.
 */
function writeBigFixture(outDir) {
  const chunk = (type, data) => {
    const head = Buffer.alloc(4);
    head.writeUInt32BE(data.length, 0);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body), 0);
    return Buffer.concat([head, body, crc]);
  };

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(BIG_SIZE, 0);
  ihdr.writeUInt32BE(BIG_SIZE, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type: truecolour

  const idat = zlib.deflateSync(
    Buffer.concat([Buffer.from([0]), Buffer.alloc(BIG_SIZE * 3)]),
  );

  fs.writeFileSync(
    path.join(outDir, BIG_FIXTURE),
    Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk('IHDR', ihdr),
      chunk('IDAT', idat),
      chunk('IEND', Buffer.alloc(0)),
    ]),
  );
}

// ---------------------------------------------------------------------------
// local generation
// ---------------------------------------------------------------------------

/**
 * Encodes every fixture format with the local sharp / qoi-img.
 *
 * Capability *flags* are not trustworthy here (a prebuilt sharp reports
 * `format.avif.output.buffer === false` while `avif()` encodes fine, and the
 * container reports `true` for both), so each format is actually encoded.
 * Nothing is written unless every format succeeded, so a failed attempt never
 * leaves a half populated fixture dir behind.
 */
async function generateLocal(outDir) {
  const modulesDir = resolveModulesDir();
  if (modulesDir === null) {
    return { ok: false, reason: 'no node_modules containing sharp (run pnpm install)' };
  }

  let sharp;
  try {
    sharp = loadModule(modulesDir, 'sharp');
  } catch (e) {
    return { ok: false, reason: `cannot load sharp: ${e.message}` };
  }

  const source = await sharp({
    create: {
      ...IMAGE_SIZE,
      channels: 4,
      background: { r: 30, g: 140, b: 200, alpha: 1 },
    },
  })
    .png()
    .toBuffer();

  const encoders = {
    png: () => Promise.resolve(source),
    jpg: () => sharp(source).jpeg().toBuffer(),
    webp: () => sharp(source).webp().toBuffer(),
    avif: () => sharp(source).avif().toBuffer(),
    jxl: () => sharp(source).jxl().toBuffer(),
    jp2: () => sharp(source).jp2().toBuffer(),
    heif: () => sharp(source).heif({ compression: 'av1' }).toBuffer(),
  };

  const variants = {};
  const failed = [];
  for (const [format, encode] of Object.entries(encoders)) {
    try {
      variants[format] = await encode();
    } catch {
      failed.push(format);
    }
  }

  let qoi = null;
  try {
    qoi = loadModule(modulesDir, 'qoi-img');
  } catch {
    failed.push('qoi');
  }

  if (failed.length > 0) {
    return { ok: false, reason: `local environment cannot produce: ${failed.join(', ')}` };
  }

  for (const [format, data] of Object.entries(variants)) {
    fs.writeFileSync(path.join(outDir, `base.${format}`), data);
  }

  const raw = await sharp(source).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  fs.writeFileSync(
    path.join(outDir, 'base.qoi'),
    qoi.QOIencode(raw.data, {
      width: raw.info.width,
      height: raw.info.height,
      channels: raw.info.channels,
    }),
  );

  return { ok: true, generatedBy: `local sharp (${modulesDir})` };
}

// ---------------------------------------------------------------------------
// container fallback
// ---------------------------------------------------------------------------

function dockerAvailable() {
  try {
    execFileSync('docker', ['version', '--format', '{{.Server.Version}}'], {
      stdio: 'ignore',
      timeout: 15000,
    });
    return true;
  } catch {
    return false;
  }
}

function imageExists(image) {
  try {
    execFileSync('docker', ['image', 'inspect', image], { stdio: 'ignore', timeout: 15000 });
    return true;
  } catch {
    return false;
  }
}

function pickImage() {
  // An explicitly requested image is authoritative: if it is not there (and
  // cannot be pulled) the run fails instead of silently using another one.
  const explicit = process.env.PICSUR_FIXTURE_IMAGE;
  const candidates = explicit
    ? [explicit]
    : [
        DEFAULT_IMAGE,
        'ghcr.io/zhemed/picsur:latest',
        'ghcr.io/zhemed/picsur:allinone',
        'zhemed/picsur:local',
      ];

  for (const image of candidates) {
    if (imageExists(image)) return image;
  }

  if (process.env.PICSUR_FIXTURE_NO_PULL === '1') return null;

  for (const image of candidates) {
    log(`  pulling ${image} (first run only; set PICSUR_FIXTURE_NO_PULL=1 to skip)`);
    try {
      execFileSync('docker', ['pull', image], { stdio: 'inherit', timeout: 10 * 60 * 1000 });
      return image;
    } catch {
      fail(`  could not pull ${image}`);
    }
  }

  return null;
}

function generateInContainer(outDir, image) {
  const args = [
    'run',
    '--rm',
    '-v',
    `${outDir}:/out`,
    '-v',
    `${__filename}:/scripts/make-image-fixtures.cjs:ro`,
    '-w',
    '/picsur/backend',
    '-e',
    'PICSUR_NODE_MODULES=/picsur/backend/node_modules',
  ];

  // Keep the generated files owned by the invoking user.
  if (typeof process.getuid === 'function' && process.getuid() !== 0) {
    args.push('--user', `${process.getuid()}:${process.getgid()}`);
  }

  args.push(
    '--entrypoint',
    'node',
    image,
    '/scripts/make-image-fixtures.cjs',
    '--generate-only',
    '--quiet',
    '/out',
  );

  execFileSync('docker', args, { stdio: 'inherit' });
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

function missingFixtures(outDir, { formatsOnly = false } = {}) {
  const missing = [];

  for (const format of ALL_FORMATS) {
    const file = path.join(outDir, `base.${format}`);
    if (!fs.existsSync(file) || fs.statSync(file).size === 0) missing.push(`base.${format}`);
  }

  if (!formatsOnly) {
    const big = path.join(outDir, BIG_FIXTURE);
    if (!fs.existsSync(big) || fs.statSync(big).size === 0) missing.push(BIG_FIXTURE);
  }

  return missing;
}

function printSummary(outDir) {
  const files = [...ALL_FORMATS.map((f) => `base.${f}`), BIG_FIXTURE];
  const width = Math.max(...files.map((f) => f.length));
  for (const file of files) {
    const size = fs.statSync(path.join(outDir, file)).size;
    log(`    ${file.padEnd(width)}  ${String(size).padStart(8)} B`);
  }
}

async function main() {
  const args = process.argv.slice(2);
  const generateOnly = args.includes('--generate-only');
  const outArg = args.find((arg) => !arg.startsWith('--'));
  const outDir = path.resolve(outArg ?? process.env.PICSUR_FIXTURES ?? '/tmp/bugs-fx');

  fs.mkdirSync(outDir, { recursive: true });
  log(`fixtures -> ${outDir}`);

  writeBigFixture(outDir);
  log(`  ${BIG_FIXTURE}: header claims ${BIG_SIZE}x${BIG_SIZE} pixels`);

  const missing = missingFixtures(outDir, { formatsOnly: true });
  if (missing.length === 0) {
    log('  all format fixtures already present');
    log(`fixtures ready in ${outDir}`);
    return;
  }
  log(`  missing: ${missing.join(', ')}`);

  const local = await generateLocal(outDir);
  if (local.ok) {
    log(`  generated by ${local.generatedBy}`);
  } else {
    log(`  local generation not possible: ${local.reason}`);

    if (generateOnly) {
      fail('FATAL: --generate-only was requested but this environment cannot generate the fixtures');
      process.exit(1);
    }

    if (!dockerAvailable()) {
      fail('');
      fail('FATAL: these fixtures need an image library with JXL/JP2 support, and docker is not');
      fail('       available to provide one. Either install the dependencies:');
      fail('');
      fail('    export PATH=/root/picsur/.run/node20/bin:$PATH   # Node 20 for the native modules');
      fail('    corepack pnpm install --frozen-lockfile');
      fail('');
      fail('or install docker (the script then generates the fixtures inside');
      fail(`${DEFAULT_IMAGE}, which ships the self compiled libvips).`);
      fail(`Offline? Drop pre-made fixtures into ${outDir} and rerun the regression.`);
      process.exit(1);
    }

    const image = pickImage();
    if (image === null) {
      fail('');
      fail('FATAL: no usable container image for the fixture fallback.');
      fail(`Pull one first:  docker pull ${DEFAULT_IMAGE}`);
      fail('or point the script at your own image:');
      fail('  PICSUR_FIXTURE_IMAGE=<image> node support/make-image-fixtures.cjs');
      process.exit(1);
    }

    log(`  falling back to container: ${image}`);
    try {
      generateInContainer(outDir, image);
    } catch (e) {
      fail(`FATAL: container generation failed: ${e.message}`);
      process.exit(1);
    }
  }

  const stillMissing = missingFixtures(outDir);
  if (stillMissing.length > 0) {
    fail(`FATAL: fixtures still missing after generation: ${stillMissing.join(', ')}`);
    process.exit(1);
  }

  log('  generated:');
  printSummary(outDir);
  log(`fixtures ready in ${outDir}`);
}

main().catch((e) => {
  fail(`FATAL: ${e && e.stack ? e.stack : e}`);
  process.exit(1);
});
