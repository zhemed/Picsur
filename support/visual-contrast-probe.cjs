#!/usr/bin/env node
/**
 * Visual contrast probe for the web client.
 *
 * Material components are themed through `--mat-*` design tokens. When our
 * (legacy) theme map does not emit the token a component asks for, that
 * component silently falls back to the Material default, which is written for
 * a *light* theme: dark grey text on our black pages, or a white panel on a
 * dark overlay. Nothing fails to build — the page is just unreadable.
 *
 * This script walks every route in both languages, computes the WCAG contrast
 * ratio of every visible piece of text against its effective background, and
 * fails when something is below the threshold. Run it after every Material
 * upgrade and whenever a new component is themed.
 *
 * Usage (needs a running instance and, normally, the resident browser):
 *
 *   node support/visual-contrast-probe.cjs \
 *     --base=http://127.0.0.1:8095 \
 *     --token=<jwt> \
 *     --out=/tmp/contrast
 *
 * Options:
 *   --base     origin to probe (default http://127.0.0.1:8095)
 *   --token    `apiKey` value put into localStorage (admin token)
 *   --cdp      CDP endpoint (default http://127.0.0.1:9222, i.e. `bw`)
 *   --routes   comma separated paths (default: every page the client serves)
 *   --langs    comma separated languages (default zh,en)
 *   --min      minimum contrast ratio for normal text (default 4.5)
 *   --out      directory for screenshots + JSON report (default /tmp/contrast)
 *   --gap      pause between pages in ms (default 3000, keeps the API throttle calm)
 *   --retries  retries for a page that did not mount (default 2)
 */

const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');

function loadPlaywright() {
  const candidates = [
    'playwright',
    'playwright-core',
    '/usr/lib/node_modules/playwright',
  ];
  for (const candidate of candidates) {
    try {
      return require(candidate);
    } catch {
      /* try the next one */
    }
  }
  throw new Error(
    'playwright not found; run this from a checkout with playwright installed',
  );
}

function parseArgs(argv) {
  const out = {};
  for (const arg of argv.slice(2)) {
    const match = /^--([a-z-]+)(?:=(.*))?$/.exec(arg);
    if (match) out[match[1]] = match[2] ?? 'true';
  }
  return out;
}

/** Everything the sidebar can reach, plus the public pages. */
const DEFAULT_ROUTES = [
  '/upload',
  '/images/1',
  '/user/login',
  '/user/register',
  '/settings/general',
  '/settings/apikeys',
  '/settings/sharex',
  '/settings/users',
  '/settings/roles',
  '/settings/system',
  '/settings/about',
  '/error/401',
  '/error/404',
];

/**
 * A blank page must not "pass", so every route carries a floor: pages that are
 * legitimately sparse (a drop zone, an error notice) need less text than a
 * settings form, and the data pages must actually render their table.
 */
const EXPECTED_TABLES = [
  '/settings/users',
  '/settings/roles',
  '/settings/apikeys',
];
const MIN_TEXT_ELEMENTS = {
  '/upload': 5,
  '/images/1': 5,
  '/user/login': 5,
  '/user/register': 5,
  '/error/401': 5,
  '/error/404': 5,
};
const DEFAULT_MIN_TEXT_ELEMENTS = 8;

/** Runs in the page: returns every text node whose contrast is too low. */
function auditInPage(minRatio) {
  const toRgb = (value) => {
    const m = String(value).match(
      /rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,/\s]+([\d.]+))?\s*\)/,
    );
    if (!m) return null;
    return {
      r: +m[1],
      g: +m[2],
      b: +m[3],
      a: m[4] === undefined ? 1 : +m[4],
    };
  };

  const blend = (top, bottom) => ({
    r: top.r * top.a + bottom.r * (1 - top.a),
    g: top.g * top.a + bottom.g * (1 - top.a),
    b: top.b * top.a + bottom.b * (1 - top.a),
    a: 1,
  });

  const luminance = ({ r, g, b }) => {
    const channel = (v) => {
      const c = v / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
  };

  const ratio = (a, b) => {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
  };

  const effectiveBackground = (element) => {
    let current = element;
    let acc = null;
    while (current) {
      const bg = toRgb(getComputedStyle(current).backgroundColor);
      if (bg && bg.a > 0) {
        acc = acc === null ? bg : blend(acc, bg);
        if (acc.a >= 1) break;
      }
      current = current.parentElement;
    }
    const page = toRgb(
      getComputedStyle(document.documentElement).backgroundColor,
    );
    if (acc === null)
      return page && page.a === 1 ? page : { r: 18, g: 18, b: 18, a: 1 };
    return acc.a >= 1
      ? acc
      : blend(acc, page && page.a === 1 ? page : { r: 18, g: 18, b: 18, a: 1 });
  };

  const ownText = (element) =>
    Array.from(element.childNodes)
      .filter((node) => node.nodeType === Node.TEXT_NODE)
      .map((node) => node.textContent.replace(/\s+/g, ' ').trim())
      .filter(Boolean)
      .join(' ');

  const findings = [];
  let checked = 0;
  for (const element of document.querySelectorAll('body *')) {
    const text = ownText(element);
    if (!text) continue;

    const style = getComputedStyle(element);
    if (style.display === 'none' || style.visibility !== 'visible') continue;
    if (+style.opacity === 0) continue;
    const rect = element.getBoundingClientRect();
    if (rect.width < 4 || rect.height < 4) continue;
    if (element.closest('[aria-hidden="true"]')) continue;

    const fgRaw = toRgb(style.color);
    if (!fgRaw) continue;
    checked += 1;
    const bg = effectiveBackground(element);
    const fg = fgRaw.a >= 1 ? fgRaw : blend(fgRaw, bg);

    const fontSize = parseFloat(style.fontSize);
    const weight = +style.fontWeight || 400;
    const large = fontSize >= 24 || (fontSize >= 18.66 && weight >= 700);
    const required = large ? Math.max(3, minRatio - 1.5) : minRatio;
    const value = ratio(fg, bg);

    if (value < required) {
      findings.push({
        tag: element.tagName.toLowerCase(),
        cls: String(element.className).slice(0, 60),
        text: text.slice(0, 40),
        fg: `rgb(${Math.round(fg.r)},${Math.round(fg.g)},${Math.round(fg.b)})`,
        bg: `rgb(${Math.round(bg.r)},${Math.round(bg.g)},${Math.round(bg.b)})`,
        ratio: Math.round(value * 100) / 100,
        required,
        size: `${Math.round(rect.width)}x${Math.round(rect.height)}`,
      });
    }
  }

  // A big light panel on a dark page reads as a bug even when its text is fine.
  const lightPanels = [];
  for (const element of document.querySelectorAll('body *')) {
    const rect = element.getBoundingClientRect();
    if (rect.width < 200 || rect.height < 40) continue;
    const bg = toRgb(getComputedStyle(element).backgroundColor);
    if (!bg || bg.a < 0.3) continue;
    if (luminance(bg) > 0.7) {
      lightPanels.push({
        tag: element.tagName.toLowerCase(),
        cls: String(element.className).slice(0, 60),
        bg: `rgb(${Math.round(bg.r)},${Math.round(bg.g)},${Math.round(bg.b)})`,
        size: `${Math.round(rect.width)}x${Math.round(rect.height)}`,
      });
    }
  }

  // Coverage: a page that renders no table/chip must not silently "pass".
  const markers = {
    textElements: checked,
    tableHeaders: document.querySelectorAll('mat-header-cell').length,
    tableCells: document.querySelectorAll('mat-cell').length,
    chips: document.querySelectorAll('mat-chip, mat-chip-row, mat-basic-chip')
      .length,
    paginators: document.querySelectorAll('mat-paginator').length,
    dialogs: document.querySelectorAll('mat-dialog-container').length,
  };

  return { findings, lightPanels, markers };
}

async function main() {
  const args = parseArgs(process.argv);
  const base = (args.base || 'http://127.0.0.1:8095').replace(/\/$/, '');
  const cdp = args.cdp || 'http://127.0.0.1:9222';
  const routes = (args.routes ? args.routes.split(',') : DEFAULT_ROUTES).filter(
    Boolean,
  );
  const langs = (args.langs ? args.langs.split(',') : ['zh', 'en']).filter(
    Boolean,
  );
  const minRatio = Number(args.min || 4.5);
  const outDir = args.out || '/tmp/contrast';
  const token = args.token || process.env.PICSUR_PROBE_TOKEN || '';
  const interactions = args.interactions !== 'false';
  const gapMs = Number(args.gap || 3000);
  const retries = Number(args.retries || 2);

  fs.mkdirSync(outDir, { recursive: true });
  const { chromium } = loadPlaywright();
  const browser = await chromium.connectOverCDP(cdp, { timeout: 30000 });

  const report = [];
  let failures = 0;

  for (const lang of langs) {
    for (const route of routes) {
      const context = await browser.newContext();
      await context.addInitScript(
        ([t, l]) => {
          try {
            if (t) localStorage.setItem('apiKey', t);
            localStorage.setItem('picsur.language', l);
            localStorage.removeItem('server-info');
          } catch {
            /* ignore */
          }
        },
        [token, lang],
      );
      const page = await context.newPage();
      const errors = [];
      const statuses = [];
      page.on('pageerror', (error) => errors.push(String(error).slice(0, 120)));
      page.on('response', (response) => {
        if (response.status() >= 400)
          statuses.push(
            `${response.status()} ${response.url().split('/api')[1] ?? ''}`,
          );
      });

      let audit = null;
      for (let attempt = 0; attempt <= retries; attempt += 1) {
        try {
          await page.goto(`${base}${route}`, {
            waitUntil: 'load',
            timeout: 60000,
          });
        } catch (error) {
          errors.push(`navigation failed: ${error.message.slice(0, 80)}`);
        }
        await page.waitForTimeout(2500);
        audit = await page.evaluate(auditInPage, minRatio);

        const needsTable = EXPECTED_TABLES.includes(route);
        const minimum = MIN_TEXT_ELEMENTS[route] ?? DEFAULT_MIN_TEXT_ELEMENTS;
        const tooThin =
          audit.markers.textElements < minimum ||
          (needsTable && audit.markers.tableHeaders === 0);
        const throttled = statuses.some((status) => status.startsWith('429'));
        if (!tooThin && !throttled) break;
        if (attempt < retries) {
          console.log(
            `     retry ${attempt + 1} for ${lang} ${route} (text=${audit.markers.textElements} table=${audit.markers.tableHeaders} throttled=${throttled})`,
          );
          statuses.length = 0;
          await page.waitForTimeout(35000);
        }
      }

      // Overlays (select panel, menus) only exist after a click, so audit them
      // too instead of assuming they are fine.
      const overlayAudits = [];
      if (interactions && route === '/settings/users') {
        const select = await page.$('mat-paginator mat-select');
        if (select) {
          await select.click().catch(() => {});
          await page.waitForTimeout(600);
          const overlay = await page.evaluate(auditInPage, minRatio);
          overlayAudits.push({
            name: 'paginator select panel',
            lowContrast: overlay.findings.length,
            lightPanels: overlay.lightPanels.length,
            findings: overlay.findings.slice(0, 5),
            panels: overlay.lightPanels.slice(0, 3),
          });
          await page.keyboard.press('Escape').catch(() => {});
          await page.waitForTimeout(300);
        }
      }
      const name = `${lang}${route.replace(/\//g, '-')}`;
      await page.screenshot({
        path: path.join(outDir, `${name}.png`),
        fullPage: true,
      });

      const needsTable = EXPECTED_TABLES.includes(route);
      const minimum = MIN_TEXT_ELEMENTS[route] ?? DEFAULT_MIN_TEXT_ELEMENTS;
      const rendered =
        audit.markers.textElements >= minimum &&
        (!needsTable || audit.markers.tableHeaders > 0);

      const overlayLow = overlayAudits.reduce(
        (sum, a) => sum + a.lowContrast,
        0,
      );
      const overlayPanels = overlayAudits.reduce(
        (sum, a) => sum + a.lightPanels,
        0,
      );
      const entry = {
        route,
        lang,
        lowContrast: audit.findings.length + overlayLow,
        lightPanels: audit.lightPanels.length + overlayPanels,
        findings: audit.findings.slice(0, 8),
        panels: audit.lightPanels.slice(0, 4),
        overlays: overlayAudits,
        markers: audit.markers,
        rendered,
        httpErrors: statuses.slice(0, 4),
        pageErrors: errors,
      };
      report.push(entry);
      if (
        entry.lowContrast > 0 ||
        entry.lightPanels > 0 ||
        errors.length > 0 ||
        !rendered
      )
        failures += 1;

      const mark =
        entry.lowContrast === 0 && entry.lightPanels === 0 && rendered
          ? 'ok  '
          : 'FAIL';
      console.log(
        `${mark} ${lang} ${route.padEnd(20)} low-contrast=${entry.lowContrast} light-panels=${entry.lightPanels} text=${entry.markers.textElements} table=${entry.markers.tableHeaders}/${entry.markers.tableCells} chips=${entry.markers.chips}${overlayAudits.length ? ` overlay=${overlayAudits[0].lowContrast}` : ''}${!rendered ? ' NOT-RENDERED' : ''}${errors.length ? ` errors=${errors.length}` : ''}`,
      );
      await context.close();
      await new Promise((resolve) => setTimeout(resolve, gapMs));
    }
  }

  await browser.close();
  const reportPath = path.join(outDir, 'report.json');
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(`\nreport: ${reportPath}`);
  console.log(
    failures === 0
      ? 'PASS: every page is readable'
      : `FAIL: ${failures} page(s) need work`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(2);
});
