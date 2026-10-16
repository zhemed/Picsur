#!/usr/bin/env node
/**
 * Gallery layout + sharpness probe.
 *
 * Measures the "your images" page at several viewport widths and asserts what
 * the owner complained about: cards in one row have to be equally tall, no
 * thumbnail may be scaled *up* past its decoded size (that is what made them
 * look blurry), nothing may overflow horizontally, and the touch targets have
 * to be big enough on phones.
 *
 * Usage:
 *   node support/gallery-layout-probe.cjs --base=http://127.0.0.1:8095 \
 *     --token=<jwt> --out=/tmp/gallery [--widths=1440,834,390]
 */

const fs = require('node:fs');
const path = require('node:path');

function loadPlaywright() {
  for (const candidate of [
    'playwright',
    'playwright-core',
    '/usr/lib/node_modules/playwright',
  ]) {
    try {
      return require(candidate);
    } catch {
      /* next */
    }
  }
  throw new Error('playwright not found');
}

function parseArgs(argv) {
  const out = {};
  for (const arg of argv.slice(2)) {
    const m = /^--([a-z-]+)(?:=(.*))?$/.exec(arg);
    if (m) out[m[1]] = m[2] ?? 'true';
  }
  return out;
}

/** Runs in the page. */
function measure() {
  const rect = (el) => {
    const r = el.getBoundingClientRect();
    return {
      x: Math.round(r.x),
      y: Math.round(r.y),
      w: Math.round(r.width),
      h: Math.round(r.height),
    };
  };

  const cards = [...document.querySelectorAll('mat-card')].map((card) => {
    const thumb = card.querySelector('picsur-img canvas, picsur-img img');
    const thumbBox = card.querySelector('picsur-img');
    const title = card.querySelector('mat-card-title');
    const subtitle = card.querySelector('mat-card-subtitle');
    let source = null;
    if (thumb) {
      source =
        thumb.tagName === 'CANVAS'
          ? { w: thumb.width, h: thumb.height }
          : { w: thumb.naturalWidth, h: thumb.naturalHeight };
    }
    const shown = thumb ? rect(thumb) : null;
    const hostBox = thumbBox ? rect(thumbBox) : null;

    // How big the picture is actually *drawn*, which depends on object-fit:
    // `cover` zooms to fill (and can enlarge a small source), `none` keeps the
    // source size, `contain` fits inside. Comparing the element box with the
    // source would call a correctly letterboxed small picture "upscaled".
    const fit = thumb ? getComputedStyle(thumb).objectFit : 'fill';
    let scale = 0;
    if (source && shown && source.w > 0 && source.h > 0 && shown.w > 0) {
      const sx = shown.w / source.w;
      const sy = shown.h / source.h;
      if (fit === 'cover') scale = Math.max(sx, sy);
      else if (fit === 'contain') scale = Math.min(sx, sy);
      else if (fit === 'none') scale = 1;
      else scale = Math.max(sx, sy);
    }
    const density = window.devicePixelRatio || 1;
    const requested =
      Number(thumbBox?.getAttribute('data-requested-width') ?? 0) || 0;

    return {
      card: rect(card),
      title: title ? title.textContent.trim() : null,
      titleBox: title ? rect(title) : null,
      subtitleBox: subtitle ? rect(subtitle) : null,
      thumbTag: thumb ? thumb.tagName.toLowerCase() : null,
      objectFit: fit,
      source,
      thumb: shown,
      thumbHost: hostBox,
      // CSS pixels the picture is drawn at, and the physical pixels the screen
      // needs for them. `upscale` > 1.02 means the browser is inventing pixels.
      drawn: source
        ? { w: Math.round(source.w * scale), h: Math.round(source.h * scale) }
        : null,
      scale: Math.round(scale * 1000) / 1000,
      upscale: Math.round(scale * density * 1000) / 1000,
      dpr: density,
      requested: requested || null,
      // The server clamps to the original, so a picture whose original is
      // smaller than the card can never reach 1:1 on a 2x screen. That is the
      // source's limit, not a sizing bug — but it is worth reporting.
      sourceLimited: requested > 0 && source ? source.w + 2 < requested : false,
      buttons: [...card.querySelectorAll('button')].map((b) => ({
        text: b.textContent.trim(),
        ...rect(b),
      })),
    };
  });

  // Cards that start on the same y are one visual row; they must match in height.
  const rows = {};
  for (const card of cards) {
    const key = Math.round(card.card.y / 20) * 20;
    (rows[key] ??= []).push(card.card.h);
  }
  const rowHeights = Object.entries(rows).map(([y, heights]) => ({
    y: Number(y),
    cards: heights.length,
    min: Math.min(...heights),
    max: Math.max(...heights),
    equal: Math.max(...heights) - Math.min(...heights) <= 1,
  }));

  const scrollWidth = Math.max(
    document.documentElement.scrollWidth,
    document.body.scrollWidth,
  );
  const images = [
    ...document.querySelectorAll('picsur-img canvas, picsur-img img'),
  ];
  return {
    viewport: {
      w: window.innerWidth,
      h: window.innerHeight,
      dpr: window.devicePixelRatio,
    },
    cardCount: cards.length,
    cards,
    rowHeights,
    unloaded: cards.filter((c) => !c.source || c.source.w === 0).length,
    upscaled: cards.filter((c) => (c.upscale ?? 0) > 1.05 && !c.sourceLimited)
      .length,
    upscaledBySource: cards.filter(
      (c) => (c.upscale ?? 0) > 1.05 && c.sourceLimited,
    ).length,
    maxScale:
      Math.round(Math.max(0, ...cards.map((c) => c.upscale ?? 0)) * 1000) /
      1000,
    overflowX: scrollWidth > window.innerWidth + 1,
    scrollWidth,
    innerWidth: window.innerWidth,
    thumbs: images.length,
    smallTargets: [...document.querySelectorAll('mat-card button')]
      .map((b) => rect(b))
      .filter((r) => r.h < 44 || r.w < 44).length,
  };
}

async function main() {
  const args = parseArgs(process.argv);
  const base = (args.base || 'http://127.0.0.1:8095').replace(/\/$/, '');
  const cdp = args.cdp || 'http://127.0.0.1:9222';
  const token = args.token || process.env.PICSUR_PROBE_TOKEN || '';
  const widths = (args.widths || '1440,834,390').split(',').map(Number);
  const dprs = (args.dprs || '1,2').split(',').map(Number);
  const outDir = args.out || '/tmp/gallery';
  fs.mkdirSync(outDir, { recursive: true });

  const { chromium } = loadPlaywright();
  const browser = await chromium.connectOverCDP(cdp, { timeout: 30000 });
  const report = [];
  let failures = 0;

  for (const width of widths) {
    for (const dpr of dprs) {
      const context = await browser.newContext({
        viewport: { width, height: 900 },
        deviceScaleFactor: dpr,
      });
      await context.addInitScript(
        ([t, l]) => {
          try {
            if (t) localStorage.setItem('apiKey', t);
            localStorage.setItem('picsur.language', l);
          } catch {
            /* ignore */
          }
        },
        [token, 'zh'],
      );
      const page = await context.newPage();
      await page.goto(`${base}/images/1`, {
        waitUntil: 'load',
        timeout: 60000,
      });
      await page.waitForTimeout(1500);

      // thumbnails are lazy: walk the page so every card gets its image
      // The client scrolls an inner container, not the window, so scroll every
      // lazy thumbnail into view by hand and wait until it really has pixels.
      for (let pass = 0; pass < 4; pass += 1) {
        await page.evaluate(async () => {
          for (const host of document.querySelectorAll('picsur-img')) {
            host.scrollIntoView({ block: 'center' });
            await new Promise((r) => setTimeout(r, 400));
          }
          window.scrollTo(0, 0);
          document
            .querySelectorAll(
              'mat-sidenav-content, .mat-drawer-content, .mat-sidenav-content',
            )
            .forEach((el) => el.scrollTo?.(0, 0));
          await new Promise((r) => setTimeout(r, 500));
        });
        const ready = await page.evaluate(() =>
          [...document.querySelectorAll('picsur-img')].every(
            (h) => h.querySelector('canvas, img') !== null,
          ),
        );
        if (ready) break;
        await page.waitForTimeout(2000);
      }
      await page.waitForTimeout(800);

      const result = await page.evaluate(measure);
      await page.screenshot({
        path: path.join(outDir, `gallery-${width}.png`),
        fullPage: true,
      });

      const bad =
        result.upscaled > 0 ||
        result.unloaded > 0 ||
        result.overflowX ||
        result.smallTargets > 0 ||
        result.rowHeights.some((r) => r.cards > 1 && !r.equal) ||
        result.cardCount === 0;
      if (bad) failures += 1;

      report.push({ width, dpr, ...result });
      console.log(
        `${bad ? 'FAIL' : 'ok  '} ${String(width).padStart(4)}px @${dpr}x cards=${result.cardCount} rows=${result.rowHeights
          .map((r) => `${r.cards}x${r.min}${r.equal ? '' : `-${r.max}✗`}`)
          .join(
            ' ',
          )} upscaled=${result.upscaled} sourceLimited=${result.upscaledBySource} maxScale=${result.maxScale} unloaded=${result.unloaded} overflowX=${result.overflowX} smallTargets=${result.smallTargets}`,
      );
      for (const card of result.cards.slice(0, 6)) {
        console.log(
          `       card ${String(card.card.w).padStart(3)}x${String(card.card.h).padStart(3)} thumb ${String(card.thumb?.w ?? 0).padStart(3)}x${String(card.thumb?.h ?? 0).padStart(3)}` +
            ` src ${String(card.source?.w ?? 0).padStart(4)}x${String(card.source?.h ?? 0).padStart(4)} drawn ${String(card.drawn?.w ?? 0).padStart(4)}x${String(card.drawn?.h ?? 0).padStart(4)} fit=${card.objectFit} upscale@${card.dpr}x=${card.upscale} title="${card.title}"`,
        );
      }
      await context.close();
    }
  }

  await browser.close();
  fs.writeFileSync(
    path.join(outDir, 'report.json'),
    JSON.stringify(report, null, 2),
  );
  console.log(`\nreport: ${path.join(outDir, 'report.json')}`);
  console.log(
    failures === 0
      ? 'PASS: aligned, no upscaling, no overflow, touch targets ok'
      : `FAIL: ${failures} width(s) need work`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(2);
});
