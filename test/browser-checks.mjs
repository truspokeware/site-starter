import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile, stat, mkdir } from 'node:fs/promises';
import { dirname, extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const AXE = resolve(ROOT, 'node_modules/axe-core/axe.min.js');
const SHOTS = process.env.TSW_SHOT_DIR || null;

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.json': 'application/json', '.xml': 'application/xml', '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json'
};

let posted = null;
const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  let path = normalize(decodeURIComponent(url.pathname));
  if (path.includes('..')) return void res.writeHead(400).end();
  if (path === '/api/intake') {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    posted = Buffer.concat(chunks).toString();
    return void res.writeHead(200, { 'content-type': 'application/json' }).end('{"ok":true}');
  }
  if (path === '/') path = '/index.html';
  try {
    const body = await readFile(join(ROOT, path));
    res.writeHead(200, { 'content-type': TYPES[extname(path)] || 'application/octet-stream' }).end(body);
  } catch {
    res.writeHead(404).end('not found');
  }
});

await new Promise((r) => server.listen(0, r));
const base = `http://localhost:${server.address().port}`;

const results = [];
const check = (name, pass, detail = '') => {
  results.push({ name, pass });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`);
};

const browser = await chromium.launch();

// ---------------------------------------------------------------- with JS ---
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await ctx.newPage();
const consoleErrors = [];
const badRequests = [];
page.on('pageerror', (e) => consoleErrors.push(String(e)));
page.on('console', (m) => m.type() === 'error' && consoleErrors.push(m.text()));
page.on('response', (r) => {
  if (r.status() >= 400 && !r.url().includes('cdn.jsdelivr.net')) badRequests.push(`${r.status()} ${r.url()}`);
});
await page.goto(`${base}/`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1200);

check('no console or page errors', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '));
check('no failed local requests', badRequests.length === 0, badRequests.slice(0, 3).join(' | '));

const loaded = await page.evaluate(() => ({
  defined: ['tsw-nav', 'tsw-button', 'tsw-icon', 'tsw-section', 'tsw-hero', 'tsw-cta', 'tsw-footer', 'tsw-form']
    .filter((t) => !customElements.get(t)),
  icons: document.querySelectorAll('tsw-icon svg').length,
  navInner: Boolean(document.querySelector('tsw-nav > .tsw-nav__inner')),
  heroInner: Boolean(document.querySelector('tsw-hero > .tsw-hero__inner')),
  status: Boolean(document.querySelector('.tsw-status'))
}));
check('kit components registered', loaded.defined.length === 0, loaded.defined.join(','));
check('icons inlined', loaded.icons > 0, `${loaded.icons} icons`);
check('nav wrapper built', loaded.navInner);
check('hero wrapper built', loaded.heroInner);

// axe
await page.addScriptTag({ path: AXE });
const axe = await page.evaluate(async () => {
  const r = await window.axe.run(document, {
    runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'] }
  });
  return r.violations.map((v) => ({
    id: v.id, impact: v.impact, n: v.nodes.length,
    sample: v.nodes[0]?.target?.join(' ') || ''
  }));
});
const serious = axe.filter((v) => v.impact === 'critical' || v.impact === 'serious');
check('axe: zero violations of any severity', axe.length === 0,
  axe.map((v) => `${v.id}[${v.impact}](${v.n}) ${v.sample}`).slice(0, 4).join(' | '));

// rendered SEO
const seo = await page.evaluate(() => ({
  title: document.title,
  desc: document.querySelector('meta[name="description"]')?.content,
  canonical: document.querySelector('link[rel="canonical"]')?.href,
  lang: document.documentElement.lang,
  h1: document.querySelector('h1')?.textContent.trim(),
  ld: document.querySelector('script[type="application/ld+json"]')?.textContent.length
}));
check('title rendered', Boolean(seo.title && seo.title.length < 70), `${seo.title?.length} chars`);
check('description in DOM', Boolean(seo.desc));
check('canonical in DOM', Boolean(seo.canonical), seo.canonical);
check('lang set', seo.lang === 'en', seo.lang);
check('single h1 has text', Boolean(seo.h1 && seo.h1.length > 10), seo.h1);
check('JSON-LD survives as script text', seo.ld > 200, `${seo.ld} bytes`);

// form behaviour
const branch = await page.evaluate(() => {
  const fs = document.querySelector('fieldset[data-tsw-branch]');
  return { hidden: fs?.hidden };
});
check('branch starts hidden', branch.hidden === true);

await page.click('input[name="urgency"][value="emergency"]');
const branchOn = await page.evaluate(() => {
  const fs = document.querySelector('fieldset[data-tsw-branch]');
  const input = fs.querySelector('input');
  return { hidden: fs.hidden, disabled: input.disabled, required: input.required };
});
check('emergency branch reveals address', branchOn.hidden === false && branchOn.disabled === false);
check('revealed branch is required', branchOn.required === true);

await page.click('input[name="urgency"][value="planning"]');
const branchOff = await page.evaluate(() => {
  const fs = document.querySelector('fieldset[data-tsw-branch]');
  return { hidden: fs.hidden, disabled: fs.querySelector('input').disabled, required: fs.querySelector('input').required };
});
check('planning hides address', branchOff.hidden === true);
check('hidden branch disabled', branchOff.disabled === true);
check('hidden branch not required', branchOff.required === false);

await page.click('input[name="urgency"][value="this-week"]');
await page.click('form[is="tsw-form"] button[type="submit"]');
await page.waitForTimeout(250);
const invalid = await page.evaluate(() => document.querySelectorAll('form[is="tsw-form"] [aria-invalid="true"]').length);
check('native validation blocks empty submit', invalid > 0, `${invalid} fields flagged`);

await page.waitForTimeout(2600);
await page.fill('#name', 'Dana Whitfield');
await page.fill('#contact-detail', 'dana@example.com');
await page.fill('#message', 'Water heater is leaking in the garage.');
await page.click('form[is="tsw-form"] button[type="submit"]');
await page.waitForSelector('form[is="tsw-form"] .tsw-status[data-tone="success"]', { timeout: 5000 }).catch(() => {});
const submitted = await page.evaluate(() => document.querySelector('.tsw-status')?.dataset.tone);
check('valid submit succeeds', submitted === 'success', String(submitted));
check('server received POST', posted !== null && posted.includes('Dana'), posted ? posted.slice(0, 60) : 'null');

// visual contract
const styles = await page.evaluate(() => {
  const cs = (sel, props) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const c = getComputedStyle(el);
    return Object.fromEntries(props.map((p) => [p, c.getPropertyValue(p)]));
  };
  return {
    primary: cs('tsw-hero tsw-button[data-variant="primary"]', ['background-color', 'padding']),
    submit: cs('form[is="tsw-form"] button[type="submit"]', ['background-color', 'padding', 'border-radius']),
    nav: cs('tsw-nav', ['position', 'backdrop-filter']),
    navInner: cs('tsw-nav > .tsw-nav__inner', ['display', 'min-height']),
    section: cs('tsw-section', ['padding-top']),
    cta: cs('tsw-cta > .tsw-cta__inner', ['text-align', 'background-color']),
    choice: cs('form[is="tsw-form"] .tsw-choice', ['display', 'cursor']),
    card: cs('tsw-card', ['display', 'border-radius', 'background-color'])
  };
});
const filled = (c) => c && c !== 'rgba(0, 0, 0, 0)' && c !== 'transparent';
check('primary button painted', filled(styles.primary?.['background-color']), styles.primary?.['background-color']);
check('nav sticky + blurred', styles.nav?.position === 'sticky' && styles.nav?.['backdrop-filter'] !== 'none');
check('nav inner is flex row', ['flex', 'inline-flex'].includes(styles.navInner?.display));
check('sections have vertical rhythm', parseFloat(styles.section?.['padding-top']) > 40, styles.section?.['padding-top']);
check('cta panel painted + centered', styles.cta?.['text-align'] === 'center' && filled(styles.cta?.['background-color']));
check('radio choices styled', styles.choice?.display === 'flex' && styles.choice?.cursor === 'pointer');
check('cards painted', filled(styles.card?.['background-color']) && parseFloat(styles.card?.['border-radius']) > 0,
  `bg=${styles.card?.['background-color']} radius=${styles.card?.['border-radius']}`);
check('native submit button painted', filled(styles.submit?.['background-color']), styles.submit?.['background-color']);

if (SHOTS) {
  await mkdir(SHOTS, { recursive: true });
  await page.addStyleTag({ content: 'tsw-nav{position:static !important}' });
  await page.screenshot({ path: join(SHOTS, 'starter-desktop.png'), fullPage: true });
  const m = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await m.goto(`${base}/`, { waitUntil: 'domcontentloaded' });
  await m.waitForTimeout(800);
  await m.screenshot({ path: join(SHOTS, 'starter-mobile.png'), fullPage: true });
  await m.click('tsw-nav [slot="toggle"]');
  await m.waitForTimeout(250);
  await m.screenshot({ path: join(SHOTS, 'starter-mobile-menu.png') });
}

await ctx.close();

// ------------------------------------------------------------- without JS ---
const noJsCtx = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 1280, height: 900 } });
const noJs = await noJsCtx.newPage();
await noJs.goto(`${base}/`, { waitUntil: 'load' });
await noJs.waitForTimeout(500);

const degraded = await noJs.evaluate(() => {
  const vis = (el) => Boolean(el && el.getBoundingClientRect().height > 0);
  return {
    h1: document.querySelector('h1')?.textContent.trim(),
    h1Visible: vis(document.querySelector('h1')),
    navVisible: vis(document.querySelector('tsw-nav')),
    heroActions: document.querySelectorAll('tsw-hero [slot="actions"] a, tsw-hero [slot="actions"] button').length,
    servicesText: document.body.innerText.includes('Leak repair'),
    areaText: document.body.innerText.includes('Sanford'),
    phoneLink: Boolean(document.querySelector('a[href^="tel:"]')),
    branchesVisible: [...document.querySelectorAll('fieldset[data-tsw-branch]')].every((f) => !f.hidden),
    formIsForm: document.querySelector('form[is="tsw-form"]')?.tagName.toLowerCase(),
    formMethod: document.querySelector('form[is="tsw-form"]')?.getAttribute('method'),
    formAction: document.querySelector('form[is="tsw-form"]')?.getAttribute('action'),
    navLinksVisible: getComputedStyle(document.querySelector('tsw-nav [slot="links"]')).display !== 'none',
    submitExists: Boolean(document.querySelector('form[is="tsw-form"] button[type="submit"]')),
    sectionPadded: parseFloat(getComputedStyle(document.querySelector('tsw-section')).paddingTop) > 0
  };
});

check('no-JS: h1 text still in DOM', Boolean(degraded.h1 && degraded.h1.length > 10), degraded.h1);
check('no-JS: h1 is visible', degraded.h1Visible);
check('no-JS: nav visible', degraded.navVisible);
check('no-JS: nav links visible without JS', degraded.navLinksVisible);
check('no-JS: sections keep padding', degraded.sectionPadded);
check('no-JS: service copy present', degraded.servicesText);
check('no-JS: service area copy present', degraded.areaText);
check('no-JS: tel: link present', degraded.phoneLink);
check('no-JS: all branches visible (nothing lost)', degraded.branchesVisible);
check('no-JS: native submit button exists', degraded.submitExists, String(degraded.submitExists));
check('no-JS: element is a real <form>', degraded.formIsForm === 'form');
check('no-JS: form has method POST', String(degraded.formMethod).toLowerCase() === 'post', degraded.formMethod);
check('no-JS: form has action', Boolean(degraded.formAction), degraded.formAction);

// native validation + POST still work with JS off
await noJs.check('input[name="urgency"][value="this-week"]');
await noJs.fill('#name', 'No JS User');
await noJs.fill('#contact-detail', 'nojs@example.com');
await noJs.fill('#message', 'Testing the no-JS path.');
await noJs.fill('#address', '2155 French Ave, Sanford FL');
posted = null;
await noJs.evaluate(() => {
  document.querySelector('form[is="tsw-form"] button[type="submit"]').click();
});
await noJs.waitForTimeout(1200);
const decoded = posted ? decodeURIComponent(posted.replace(/\+/g, ' ')) : '';
check('no-JS: native submit reaches the endpoint', decoded.includes('No JS User') && decoded.includes('service_address=2155'),
  decoded.slice(0, 90));
check('no-JS: body is urlencoded form data, not JSON', posted.startsWith('urgency=') && !posted.trim().startsWith('{'),
  posted.slice(0, 20));

await noJsCtx.close();
await browser.close();
server.close();

function note(m) { console.log(`  . ${m}`); }

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) {
  console.log('failures: ' + failed.map((f) => f.name).join(', '));
  process.exit(1);
}
