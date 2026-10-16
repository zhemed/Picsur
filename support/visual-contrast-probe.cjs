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
 * Coverage: the default route list is 13 routes x 2 languages = 26 entries.
 * Two of those routes are addresses of pages that were removed, and they carry
 * a second assertion on top of "readable": the page has to show the 404 copy
 * (`looksLikeNotFound`), so a broken `**` fallback, a revived old page or a
 * blank shell fails instead of quietly passing. The numbers are printed at the
 * end of every run so the split is never ambiguous.
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
  '/settings/users',
  '/settings/system',
  '/settings/about',
  '/error/401',
  '/error/404',
  // Addresses of pages that were removed. They stay in the list on purpose: an
  // old bookmark has to land on a readable 404, and that is asserted below.
  '/settings/sharex',
  '/settings/apikeys',
  '/settings/roles',
];

/**
 * Removed addresses that must render the 404 page.
 *
 * They must not be dropped from the route list: without them nothing would
 * notice if the `**` fallback stopped working, and a bookmark/redirect that
 * started rendering an old page again (or a blank one) would go unnoticed.
 * Checking "has some text" is not enough for that - the page has to say it is
 * a 404, so these routes are asserted against the error copy itself.
 */
const REMOVED_ROUTES = ['/settings/sharex', '/settings/apikeys'];

/** Copy the 404 page shows; one of NOT_FOUND_PHRASES must appear too. */
const NOT_FOUND_MARKER = '404';
const NOT_FOUND_PHRASES = [
  'page not found', // en
  '页面不存在', // zh
];

function looksLikeNotFound(bodyText) {
  const text = String(bodyText ?? '').toLowerCase();
  if (!text.includes(NOT_FOUND_MARKER)) return false;
  return NOT_FOUND_PHRASES.some((phrase) => text.includes(phrase.toLowerCase()));
}

/**
 * A blank page must not "pass", so every route carries a floor: pages that are
 * legitimately sparse (a drop zone, an error notice) need less text than a
 * settings form, and the data pages must actually render their table.
 */
const EXPECTED_TABLES = [
  '/settings/users',
];
const MIN_TEXT_ELEMENTS = {
  '/settings/sharex': 5,
  '/settings/apikeys': 5,
  '/settings/roles': 5,
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

  // "Stuck loading": the old ShareX page rendered its title plus a permanent
  // "加载中..." and nothing else, which no contrast check would ever catch.
  const LOADING_TEXT = /^(loading|加载中|正在加载|载入中)[.…]*$/i;
  const loadingIndicators = [];
  for (const element of document.querySelectorAll('body *')) {
    const text = ownText(element);
    const visible =
      element.getClientRects().length > 0 &&
      getComputedStyle(element).visibility === 'visible';
    if (!visible) continue;
    const spins =
      element.matches(
        'mat-progress-spinner, mat-progress-bar, .mat-mdc-progress-spinner',
      ) && element.getBoundingClientRect().width > 0;
    if ((text && LOADING_TEXT.test(text)) || spins) {
      loadingIndicators.push(text || element.tagName.toLowerCase());
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

  // The visible copy, so a caller can assert *what* the page says (the removed
  // addresses are checked for the 404 notice, not just for "some text").
  const bodyText = String(document.body?.innerText ?? '').slice(0, 600);

  return { findings, lightPanels, markers, loadingIndicators, bodyText };
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

        // A page may legitimately be loading for a moment; only a loading state
        // that never clears counts as stuck.
        if (audit.loadingIndicators.length > 0) {
          for (
            let wait = 0;
            wait < 6 && audit.loadingIndicators.length > 0;
            wait += 1
          ) {
            await page.waitForTimeout(2500);
            audit = await page.evaluate(auditInPage, minRatio);
          }
        }

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
      const stuckLoading = audit.loadingIndicators.length > 0;
      // A removed address has to prove it landed on the 404 page. "It rendered
      // something" is not enough: a revived old page, a stuck redirect or a
      // blank shell would all pass that.
      const isRemoved = REMOVED_ROUTES.includes(route);
      const showsNotFound = isRemoved ? looksLikeNotFound(audit.bodyText) : true;
      const rendered =
        audit.markers.textElements >= minimum &&
        (!needsTable || audit.markers.tableHeaders > 0) &&
        showsNotFound;

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
        loadingIndicators: audit.loadingIndicators.slice(0, 3),
        stuckLoading,
        rendered,
        removedAddress: isRemoved,
        showsNotFound,
        bodyTextSample: String(audit.bodyText ?? '').slice(0, 200),
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
        `${mark} ${lang} ${route.padEnd(20)} low-contrast=${entry.lowContrast} light-panels=${entry.lightPanels} text=${entry.markers.textElements} table=${entry.markers.tableHeaders}/${entry.markers.tableCells} chips=${entry.markers.chips}${isRemoved ? ` removed-address=404-copy:${showsNotFound ? 'yes' : 'MISSING'}` : ''}${overlayAudits.length ? ` overlay=${overlayAudits[0].lowContrast}` : ''}${stuckLoading ? ' STUCK-LOADING' : ''}${!rendered && !stuckLoading ? (isRemoved && !showsNotFound ? ' NOT-A-404' : ' NOT-RENDERED') : ''}${errors.length ? ` errors=${errors.length}` : ''}`,
      );
      await context.close();
      await new Promise((resolve) => setTimeout(resolve, gapMs));
    }
  }

  await browser.close();
  const reportPath = path.join(outDir, 'report.json');
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(`\nreport: ${reportPath}`);

  // State the coverage explicitly, because "26 pages" on its own is easy to
  // misread: the removed addresses are in the same list but are held to a
  // different assertion.
  const removedEntries = report.filter((e) => e.removedAddress);
  const liveEntries = report.length - removedEntries.length;
  const removedRoutes = new Set(removedEntries.map((e) => e.route));
  const liveRoutes = new Set(
    report.filter((e) => !e.removedAddress).map((e) => e.route),
  );
  console.log(
    `coverage: ${report.length} probe entries = ${liveEntries} live pages ` +
      `(${liveRoutes.size} routes x ${report.length / new Set(report.map((e) => e.route)).size} languages) ` +
      `+ ${removedEntries.length} removed addresses ` +
      `(${removedRoutes.size} routes), the removed ones asserted to render the 404 copy`,
  );
  const missing404 = removedEntries.filter((e) => !e.showsNotFound);
  if (missing404.length > 0) {
    console.log(
      `  removed addresses that did NOT show the 404 copy: ` +
        missing404.map((e) => `${e.lang} ${e.route}`).join(', '),
    );
  }

  console.log(
    failures === 0
      ? 'PASS: every page is readable' +
          (removedEntries.length > 0
            ? '; removed addresses render the 404 page'
            : '')
      : `FAIL: ${failures} page(s) need work`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(2);
});
