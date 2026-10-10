import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile, stat, mkdir } from 'node:fs/promises';
import { dirname, extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PAGES = (process.env.TSW_PAGES || '/').split(',').map((p) => p.trim()).filter(Boolean);
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

  // Candidate resolution, so a directory route like /bookkeeping/ serves its
  // index.html. Cloudflare does this; a naive path + '.html' does not, and every
  // subdirectory page then reads as a 404.
  const candidates = extname(path) || path.startsWith('/api')
    ? [path]
    : [`${path}.html`, path.replace(/\/$/, '') + '/index.html', path];

  for (const candidate of candidates) {
    try {
      const body = await readFile(join(ROOT, candidate));
      res.writeHead(200, {
        'content-type': TYPES[extname(candidate)] || 'application/octet-stream',
        'cache-control': 'no-store'
      }).end(body);
      return;
    } catch {
      // try the next candidate
    }
  }
  res.writeHead(404).end('not found');
});

await new Promise((r) => server.listen(0, r));
const base = `http://localhost:${server.address().port}`;

const results = [];
const note = (m) => console.log(`  . ${m}`);
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
for (const route of PAGES) {
  await page.goto(`${base}${route}`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(900);

  check(`${route}: no console or page errors`, consoleErrors.length === 0, consoleErrors.slice(0, 2).join(' | '));
  check(`${route}: no failed local requests`, badRequests.length === 0, badRequests.slice(0, 2).join(' | '));
  consoleErrors.length = 0;
  badRequests.length = 0;

  const p = await page.evaluate(() => ({
    defined: ['tsw-nav','tsw-button','tsw-icon','tsw-section','tsw-hero','tsw-cta','tsw-footer','tsw-disclosure']
      .filter((t) => !customElements.get(t)),
    title: document.title,
    desc: document.querySelector('meta[name="description"]')?.content || '',
    canonical: document.querySelector('link[rel="canonical"]')?.href,
    // Read from the document. A noindex page must not advertise a canonical.
    noindex: /noindex/.test(document.querySelector('meta[name="robots"]')?.content || ''),
    h1: [...document.querySelectorAll('h1')].map((h) => h.textContent.trim()),
    landmarks: {
      header: Boolean(document.querySelector('header')),
      main: Boolean(document.querySelector('main')),
      footer: Boolean(document.querySelector('footer'))
    }
  }));

  check(`${route}: kit components registered`, p.defined.length === 0, p.defined.join(','));
  check(`${route}: title under 70 chars`, p.title.length > 0 && p.title.length < 70, `${p.title.length} chars`);
  check(`${route}: description 70-160 chars`, p.desc.length >= 70 && p.desc.length <= 160, `${p.desc.length} chars`);
  // A 404 document must not carry a canonical or an indexable robots directive.
  if (p.noindex) {
    check(`${route}: no canonical on a noindex page`, !p.canonical, String(p.canonical));
  } else {
    check(`${route}: canonical present`, Boolean(p.canonical), p.canonical);
  }
  check(`${route}: exactly one h1`, p.h1.length === 1, p.h1.length ? p.h1[0].slice(0, 50) : 'none');
  check(`${route}: has header, main and footer landmarks`,
    p.landmarks.header && p.landmarks.main && p.landmarks.footer,
    JSON.stringify(p.landmarks));

  await page.addScriptTag({ path: AXE });
  const v = await page.evaluate(async () => {
    const r = await window.axe.run(document, {
      runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'] }
    });
    return r.violations.map((x) => ({ id: x.id, impact: x.impact, n: x.nodes.length, sample: x.nodes[0]?.target?.join(' ') || '' }));
  });
  check(`${route}: axe zero violations`, v.length === 0,
    v.map((x) => `${x.id}[${x.impact}](${x.n}) ${x.sample}`).slice(0, 3).join(' | '));
}

await page.goto(`${base}${PAGES[0]}`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(900);

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
const serious = [];
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

// Form behaviour, on whichever page hosts the form. A site with no form at all,
// such as a utility, skips this section rather than failing against a route that
// was never meant to exist.
const FORM_ROUTE = process.env.TSW_FORM_PAGE || null;
let formRoute = FORM_ROUTE;
if (!formRoute) {
  for (const route of PAGES) {
    await page.goto(`${base}${route}`, { waitUntil: 'domcontentloaded' });
    const found = await page.evaluate(() => Boolean(document.querySelector('form[is="tsw-form"]')));
    if (found) {
      formRoute = route;
      break;
    }
  }
}
if (formRoute) {
  await page.goto(`${base}${formRoute}`, { waitUntil: 'domcontentloaded' });
  // The kit treats a submit within 2.5 seconds of render as automated, and it
  // fakes success without sending anything, so the clock starts here.
  await page.waitForTimeout(2800);

  const form = await page.evaluate(() => {
    const f = document.querySelector('form[is="tsw-form"]');
    return f
      ? { branches: f.querySelectorAll('fieldset[data-tsw-branch]').length, radios: f.querySelectorAll('input[type="radio"]').length }
      : null;
  });
  check('intake form present', form !== null, formRoute);

  // Branching is optional. A simple contact form has none, and requiring one
  // would push every site toward a branch it does not need.
  if (form && form.branches > 0) {
    check('intake form has branching fieldsets', true, String(form.branches));
  } else {
    note('intake form has no branching fieldsets, which is allowed');
  }
  // Two is enough to make a choice control meaningful. Requiring more pushes
  // every site toward radio groups it does not need.
  check('intake form has radio choices', (form?.radios ?? 0) >= 2, String(form?.radios));

  if (form && form.branches > 0) {
    const branchName = await page.evaluate(() => document.querySelector('fieldset[data-tsw-branch]')?.getAttribute('data-tsw-branch'));
    const branchValue = await page.evaluate((n) => {
      const fs = document.querySelector('fieldset[data-tsw-branch]');
      return fs?.getAttribute('data-tsw-branch-values')?.split(',').map((v) => v.trim())[0];
    }, branchName);

    const branchHiddenAtStart = await page.evaluate(() => {
      const fs = document.querySelector('fieldset[data-tsw-branch]');
      return getComputedStyle(fs).display === 'none';
    });
    check('branch not rendered before selection', branchHiddenAtStart === true);

    await page.check(`input[name="${branchName}"][value="${branchValue}"]`);
    const branchOn = await page.evaluate(() => {
      const fs = document.querySelector('fieldset[data-tsw-branch]');
      const input = fs.querySelector('input, select, textarea');
      return { shown: getComputedStyle(fs).display !== 'none', disabled: input.disabled, required: input.required };
    });
    check('branch revealed on match', branchOn.shown === true && branchOn.disabled === false);
    check('revealed branch is required', branchOn.required === true);

    const offValue = await page.evaluate(() => {
      const fs = document.querySelector('fieldset[data-tsw-branch]');
      const name = fs.getAttribute('data-tsw-branch');
      const on = fs.getAttribute('data-tsw-branch-values').split(',').map((v) => v.trim());
      const group = [...document.querySelectorAll(`input[type="radio"][name="${name}"]`)];
      return group.find((r) => !on.includes(r.value))?.value;
    });
    await page.check(`input[name="${branchName}"][value="${offValue}"]`);
    const branchOff = await page.evaluate(() => {
      const fs = document.querySelector('fieldset[data-tsw-branch]');
      const input = fs.querySelector('input, select, textarea');
      return { shown: getComputedStyle(fs).display !== 'none', disabled: input.disabled, required: input.required };
    });
    check('branch hidden on mismatch', branchOff.shown === false);
    check('hidden branch disabled', branchOff.disabled === true);
    check('hidden branch not required', branchOff.required === false);

    // Put the branch back. Leaving it collapsed leaves required controls in the
    // DOM that cannot be seen or filled, and the submit below is then blocked for
    // a reason that has nothing to do with what is being tested.
    await page.check(`input[name="${branchName}"][value="${branchValue}"]`);
  }

  await page.click('form[is="tsw-form"] button[type="submit"]');
  await page.waitForTimeout(300);
  const invalid = await page.evaluate(() => document.querySelectorAll('form[is="tsw-form"] [aria-invalid="true"]').length);
  check('native validation blocks empty submit', invalid > 0, `${invalid} fields flagged`);

  posted = null;

  // Discover the fields rather than naming them. A template that hardcodes
  // `business_name` or fills "Sanford" into a city box passes on the site it was
  // written against and fails on every other one.
  const shape = await page.evaluate(() => {
    const f = document.querySelector('form[is="tsw-form"]');
    return {
      names: [...new Set([...f.querySelectorAll('input:not([type=hidden]):not([type=radio]):not([type=checkbox]), select, textarea')]
        .map((el) => el.name).filter(Boolean))],
      message: f.querySelector('textarea[name]')?.name || null,
      contact: [...f.querySelectorAll('input[type="text"], input[type="email"], input[type="tel"], input[type="url"]')]
        .map((el) => ({ name: el.name, type: el.type })).filter((x) => x.name)
    };
  });
  check('intake form has submittable controls', shape.names.length > 0, shape.names.join(','));

  const VALUES = {
    business_name: 'Verification Plumbing',
    name: 'Verification User',
    email: 'verify@example.com',
    message: 'End to end check of the deployed intake endpoint.'
  };
  const fillFor = (name, type) => {
    // Never fill the honeypot. A filled trap makes the kit believe it is being
    // automated, and it fakes success without sending anything, which looks
    // exactly like a working submission.
    if (name === 'tsw_website_url' || name === 'website_url') return '';
    if (VALUES[name]) return VALUES[name];
    if (name === shape.message) return VALUES.message;
    if (type === 'url') return 'https://example.com';
    if (type === 'email') return VALUES.email;
    return 'Verification Value';
  };
  for (const el of await page.$$('form[is="tsw-form"] input:not([type=hidden]):not([type=radio]):not([type=checkbox]), form[is="tsw-form"] select, form[is="tsw-form"] textarea')) {
    const info = await el.evaluate((n) => ({ name: n.name, type: n.type, visible: n.getBoundingClientRect().height > 0, disabled: n.disabled }));
    if (!info.name || !info.visible || info.disabled) continue;
    if (info.name === 'tsw_website_url' || info.name === 'website_url') continue;
    await el.fill(fillFor(info.name, info.type));
  }
  await page.click('form[is="tsw-form"] button[type="submit"]');
  const tone = await page
    .waitForSelector('form[is="tsw-form"] .tsw-status[data-tone]', { timeout: 8000 })
    .then((el) => el.getAttribute('data-tone'))
    .catch(() => null);
  check('submit reaches a terminal status', tone === 'success' || tone === 'error', String(tone));
  if (tone === 'error') {
    const text = await page.textContent('form[is="tsw-form"] .tsw-status');
    check('status message is actionable', Boolean(text && text.length > 20), text);
  }

  // The kit sets its status attribute as soon as the fetch resolves, which can
  // be before the stub has finished draining the request body. Wait for the
  // capture rather than assuming it has landed.
  for (let i = 0; i < 60 && posted === null; i += 1) {
    await new Promise((r) => setTimeout(r, 50));
  }

  const echoed = posted ? decodeURIComponent(posted.replace(/\+/g, ' ')) : '';
  check('submit carries the entered values to the endpoint',
    Object.values(VALUES).some((v) => echoed.includes(v)),
    echoed.slice(0, 90) || 'nothing posted');
}

// form behaviour, exercised on whichever page hosts the form
// ------------------------------------------------------------- without JS ---
// The point of this whole architecture: every page must work, and be
// submittable, with scripting off.
for (const route of PAGES) {
  const noJsCtx = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 1280, height: 900 } });
  const noJs = await noJsCtx.newPage();
  await noJs.goto(`${base}${route}`, { waitUntil: 'load' });
  await noJs.waitForTimeout(400);

  const degraded = await noJs.evaluate(() => {
    const vis = (el) => Boolean(el && el.getBoundingClientRect().height > 0);
    // Null-safe style reads. A page that uses a bare nav or a section of its own
    // shape must not take the whole run down with a TypeError.
    const shown = (sel) => {
      const el = document.querySelector(sel);
      return Boolean(el) && getComputedStyle(el).display !== 'none';
    };
    const padded = (sel) => {
      const el = document.querySelector(sel);
      return Boolean(el) && parseFloat(getComputedStyle(el).paddingTop) > 0;
    };
    const form = document.querySelector('form[is="tsw-form"]');
    return {
      h1: document.querySelector('h1')?.textContent.trim(),
      h1Visible: vis(document.querySelector('h1')),
      navVisible: vis(document.querySelector('tsw-nav')),
      navLinksVisible: shown('tsw-nav [slot="links"]'),
      sectionPadded: padded('tsw-section'),
      bodyText: document.body.innerText,
      // Whether a contact method exists is a per-site fact from the manifest, not
      // a property of the template. Assert only that contact links, if present,
      // are real ones.
      links: [...document.querySelectorAll('a[href]')]
        .map((a) => a.getAttribute('href'))
        .filter((h) => /^(tel:|mailto:)/.test(h)),
      submitExists: Boolean(form?.querySelector('button[type="submit"]')),
      formTag: form?.tagName.toLowerCase(),
      formMethod: form?.getAttribute('method'),
      formAction: form?.getAttribute('action'),
      branchesVisible: [...document.querySelectorAll('fieldset[data-tsw-branch]')].every((f) => !f.hidden),
      cardsPainted: (() => {
        const c = document.querySelector('tsw-card');
        if (!c) return null;
        const s = getComputedStyle(c);
        return { bg: s.backgroundColor, radius: s.borderTopLeftRadius, display: s.display };
      })()
    };
  });

  check(`${route} no-JS: h1 text in DOM`, Boolean(degraded.h1 && degraded.h1.length > 8), degraded.h1);
  check(`${route} no-JS: h1 visible`, degraded.h1Visible);
  check(`${route} no-JS: nav visible`, degraded.navVisible);
  check(`${route} no-JS: nav links visible`, degraded.navLinksVisible);
  check(`${route} no-JS: sections keep padding`, degraded.sectionPadded);
  if (degraded.cardsPainted) {
    check(`${route} no-JS: cards painted`, degraded.cardsPainted.bg !== 'rgba(0, 0, 0, 0)' && parseFloat(degraded.cardsPainted.radius) > 0,
      JSON.stringify(degraded.cardsPainted));
  }
  check(`${route} no-JS: all branch fieldsets visible`, degraded.branchesVisible);
  check(`${route} no-JS: contact links are well formed`,
    degraded.links.every((h) => /^(tel:\+?[0-9() .-]{7,}|mailto:[^\s@]+@[^\s@]+\.[^\s@]+)$/.test(h)),
    degraded.links.join(' | '));

  if (degraded.submitExists) {
    check(`${route} no-JS: element is a real <form>`, degraded.formTag === 'form', degraded.formTag);
    check(`${route} no-JS: method POST`, String(degraded.formMethod).toLowerCase() === 'post', degraded.formMethod);
    check(`${route} no-JS: has action`, Boolean(degraded.formAction), degraded.formAction);

    posted = null;
    await noJs.evaluate(() => {
      const f = document.querySelector('form[is="tsw-form"]');

      // Satisfy every required control, whatever the branch state ends up being.
      // With scripting off every branch fieldset is visible, so they all count.
      const placeholder = 'Verification Value';
      for (const group of [...new Set([...f.querySelectorAll('input[type="radio"][required]')].map((r) => r.name))]) {
        const options = [...f.querySelectorAll(`input[type="radio"][name="${group}"]`)];
        const on = options.find((o) => o.checked);
        if (!on && options[0]) options[0].checked = true;
      }
      for (const el of f.querySelectorAll('input:not([type=radio]):not([type=hidden]), select, textarea')) {
        if (el.type === 'url') el.value = 'https://example.com';
        else if (el.name === 'message') el.value = 'Verifying the no-script submit path.';
        else if (el.value === '' && el.required) el.value = placeholder;
      }
      f.querySelector('button[type="submit"]').click();
    });
    await noJs.waitForTimeout(1200);

    const decoded = posted ? decodeURIComponent(posted.replace(/\+/g, ' ')) : '';
    check(`${route} no-JS: submit reaches the endpoint`, decoded.includes('Verification Value'),
      decoded.slice(0, 70) || 'nothing posted');
    check(`${route} no-JS: body is urlencoded form data`,
      Boolean(posted) && /^[a-z_]+=/.test(posted) && !posted.trim().startsWith('{'),
      (posted || '').slice(0, 28));
  }

  await noJsCtx.close();
}

await browser.close();
server.close();

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) {
  console.log('failures: ' + failed.map((f) => f.name).join(', '));
  process.exit(1);
}
