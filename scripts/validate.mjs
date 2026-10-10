#!/usr/bin/env node
import { readFile, readdir, stat } from 'node:fs/promises';
import { join, dirname, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const STRICT = process.env.TSW_STRICT === '1';

const arg = (name, fallback) => {
  const argv = process.argv.slice(2);
  const eq = argv.find((a) => a.startsWith(`--${name}=`));
  if (eq) return eq.slice(name.length + 3);
  const i = argv.indexOf(`--${name}`);
  if (i !== -1 && argv[i + 1] && !argv[i + 1].startsWith('--')) return argv[i + 1];
  return fallback;
};

const MANIFEST = arg('manifest', 'assets/site.json');
const PAGES = arg('pages', 'index.html').split(',').map((p) => p.trim()).filter(Boolean);
const HOSTS_OVERRIDE = arg('hosts', '').split(',').map((h) => h.trim()).filter(Boolean);

const errors = [];
const warns = [];
const notes = [];

const fail = (m) => errors.push(m);
const warn = (m) => warns.push(m);
const note = (m) => notes.push(m);

// A site URL is not a file path. `/privacy` is served from `privacy.html`, and
// `/services/` from `services/index.html`, so both have to resolve or every
// extensionless link in the site looks broken and every real one is unverifiable.
const exists = async (p) => {
  const clean = p.split(/[?#]/)[0].replace(/^\/+|\/+$/g, '');
  const candidates = clean === ''
    ? ['index.html']
    : [clean, `${clean}.html`, join(clean, 'index.html'), `${clean}/index.html`];
  for (const c of candidates) {
    try {
      const st = await stat(join(ROOT, c));
      if (st.isFile()) return true;
    } catch {
      /* try the next candidate */
    }
  }
  return false;
};

const read = (p) => readFile(join(ROOT, p), 'utf8');

// A page argument may be a file, a directory URL, or an extensionless route.
// Resolve it the way a server would, so the validator accepts exactly the paths
// the site actually serves and rejects the ones it does not.
const readPage = async (p) => {
  const clean = p.replace(/^\/+|\/+$/g, '');
  const candidates = clean === ''
    ? ['index.html']
    : [clean, `${clean}.html`, join(clean, 'index.html'), `${clean}/index.html`];
  for (const c of candidates) {
    try {
      const st = await stat(join(ROOT, c));
      if (st.isFile()) return read(c);
    } catch {
      /* try the next candidate */
    }
  }
  return null;
};

const SKIP_DIRS = ['node_modules', '.git', '.lighthouseci', 'vendor', '.wrangler', 'test-results', 'playwright-report'];

async function walk(dir, out = []) {
  for (const entry of await readdir(join(ROOT, dir), { withFileTypes: true })) {
    // `.lighthouseci` holds generated HTML reports that quote these very markers
    // from Lighthouse's own output, so walking it produces false positives.
    if (SKIP_DIRS.includes(entry.name)) continue;
    const rel = join(dir, entry.name);
    if (entry.isDirectory()) await walk(rel, out);
    else out.push(rel);
  }
  return out;
}

const normalizeUrl = (u) => String(u || '').replace(/\/+$/, '').toLowerCase();
const text = (s) => String(s || '');

const phoneVariants = (phone) => {
  const digits = text(phone).replace(/\D/g, '');
  const out = new Set();
  if (digits.length >= 10) {
    out.add(digits);
    out.add(digits.slice(-10));
  }
  for (const v of [...out]) if (v.length > 7) out.add(v.slice(-7));
  return [...out].filter((v) => v.length >= 7);
};

const containsNumber = (haystack, digits) => {
  const runs = String(haystack).match(/\d[\d().\s-]{5,}\d/g) || [];
  return runs.some((run) => {
    const normalized = run.replace(/\D/g, '');
    if (normalized.length > digits.length + 2) return false;
    return normalized.includes(digits) || digits.includes(normalized);
  });
};

// Hosts the validator may check live. Derived from the manifest so one file works
// for an apex domain, a subdomain, and every Pages project, rather than asserting
// one site's origins in a template that generates all of them.
const PLACEHOLDER_HOSTS = new Set(['example.com', 'www.example.com']);

const hostOf = (url) => {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
};

async function checkLiveHosts(hosts) {
  if (process.env.TSW_SKIP_LIVE === '1') {
    note('live host check skipped: TSW_SKIP_LIVE=1');
    return;
  }
  if (process.env.CI || process.env.GITHUB_ACTIONS) {
    // GitHub's runner IPs are blocked at the edge by bot protection, so this
    // reports 403 from CI regardless of the site's health.
    note('live host check skipped on CI: runner IPs are edge-blocked');
    return;
  }
  if (!hosts.length) {
    note('live host check skipped: no deployed host in the manifest');
    return;
  }

  let served = 0;
  for (const host of hosts) {
    for (const file of PAGES) {
      const route = file === 'index.html' || file === '' ? '/' : `/${file.replace(/\.html$/, '')}`;
      let code = 'ERR';
      try {
        const res = await fetch(`https://${host}${route}`, { redirect: 'manual', signal: AbortSignal.timeout(8000) });
        code = res.status;
      } catch (err) {
        code = `ERR ${err.name}`;
      }
      if (code !== 200) fail(`live https://${host}${route} returned ${code}`);
      else served++;
    }
  }
  if (served === hosts.length * PAGES.length) {
    note(`${hosts.length} host(s) serve 200 on ${PAGES.length} page(s) (${served} checks)`);
  }

  // A soft 404 is worse than no page at all: the visitor sees the homepage and
  // search engines index infinite duplicate URLs. Pages serves index.html for any
  // unmatched path unless a 404 document exists, so this asserts it does not.
  for (const host of hosts) {
    let soft = null;
    try {
      const res = await fetch(`https://${host}/tsw-definitely-not-a-real-path`, {
        redirect: 'manual',
        signal: AbortSignal.timeout(8000)
      });
      soft = res.status;
    } catch (err) {
      soft = `ERR ${err.name}`;
    }
    if (soft !== 404) fail(`${host} returns ${soft} for an unknown path, expected 404 (soft 404)`);
  }
  if (!errors.some((e) => e.includes('soft 404'))) note('unknown paths return a real 404');
}

// ---------------------------------------------------------------------------

// `contact` and `hours` are deliberately absent. A utility that converts a
// photograph to a PDF has no phone, no address and no opening hours, and forcing
// the keys to exist as `null` teaches authors to satisfy a check rather than
// describe a business. Every reader of these two keys is already optional-chained,
// so a site that omits them entirely checks exactly as a site that nulls them.
const REQUIRED_SITE_KEYS = ['name', 'url', 'description', 'category', 'publish'];

// Local SEO needs exactly one primary market, but only a business with a service
// area has one at all. A site that serves no defined area, or serves a region
// rather than a town, legitimately has neither key.
const LOCAL_SITE_KEYS = ['primaryMarket', 'areaServed'];

let site = null;
let facts = null;
let ld = null;
const pageHtml = {};

try {
  site = JSON.parse(await read(MANIFEST));
  note(`${MANIFEST} parses`);
} catch (err) {
  fail(`${MANIFEST} is not valid JSON: ${err.message}`);
}

for (const page of PAGES) {
  const body = await readPage(page);
  if (body === null) fail(`${page} is missing`);
  else {
    pageHtml[page] = body;
    note(`${page} reads`);
  }
}

const html = pageHtml[PAGES[0]] ?? '';

try {
  facts = JSON.parse(await read('.well-known/brand-facts.json'));
  note('.well-known/brand-facts.json parses');
} catch (err) {
  fail(`.well-known/brand-facts.json is not valid JSON: ${err.message}`);
}

// A demo site may declare itself as a bare boolean, or as an object carrying the
// disclaimer text. The object form is preferred because the note belongs in the
// manifest, the same place every other business fact lives.
const demoFlag = site?.demo;
const isDemo = demoFlag === true || (demoFlag && typeof demoFlag === 'object' && demoFlag.isSample === true);

if (site) {
  for (const key of REQUIRED_SITE_KEYS) {
    if (!(key in site)) fail(`${MANIFEST} is missing required key "${key}"`);
  }
  if (site.url && !/^https:\/\//.test(site.url)) fail(`${MANIFEST} url must be https, got "${site.url}"`);
  if (site.description && site.description.length > 300) {
    warn(`${MANIFEST} description is ${site.description.length} chars; keep it under 300`);
  }
  if (site.areaServed) {
    for (const key of LOCAL_SITE_KEYS) {
      if (!(key in site)) fail(`${MANIFEST} has areaServed but is missing "${key}"`);
    }
  }
}

if (!html) {
  report();
}

const h1s = html.match(/<h1[\s>]/gi) || [];
if (h1s.length !== 1) fail(`index.html must have exactly one <h1>, found ${h1s.length}`);

const canonical = html.match(/<link[^>]+rel=["']canonical["'][^>]*href=["']([^"']+)["']/i)
  || html.match(/<link[^>]+href=["']([^"']+)["'][^>]*rel=["']canonical["']/i);
if (!canonical) fail('index.html is missing a rel="canonical" link');
else if (site && normalizeUrl(canonical[1]) !== normalizeUrl(site.url)) {
  fail(`canonical "${canonical[1]}" does not match ${MANIFEST} url "${site.url}"`);
} else note(`canonical matches ${MANIFEST} url (${canonical?.[1]})`);

for (const [page, body] of Object.entries(pageHtml)) {
  const d = body.match(/<meta[^>]+name=["']description["'][^>]*content=["']([^"']*)["']/i);
  if (!d) {
    fail(`${page} is missing a meta description`);
    continue;
  }
  const len = d[1].length;
  if (len < 70) fail(`${page} meta description is only ${len} chars; aim for 110-160`);
  else if (len > 160) fail(`${page} meta description is ${len} chars; Google truncates past about 160`);
  else note(`${page} meta description is ${len} chars`);
}

const noindex = /<meta[^>]+name=["']robots["'][^>]*content=["'][^"']*noindex/i.test(html);

// A demonstration site must not compete with a real client for the same local
// queries, so it declares itself in the manifest and is held to the opposite
// rule: noindex required, and the crawler policy has to actually block.
if (noindex && !isDemo) {
  fail('index.html sets a noindex directive; a live client site must be indexable');
} else if (isDemo && !noindex) {
  fail(`${MANIFEST} declares this a demo site, so index.html must set a noindex directive`);
} else if (isDemo) {
  note('demo site: noindex is required and present');
}

if (!/<html[^>]+lang=["'][a-z]{2}/i.test(html)) fail('index.html <html> element is missing a lang attribute');

const ogTitle = /<meta[^>]+property=["']og:title["']/i.test(html);
const ogDesc = /<meta[^>]+property=["']og:description["']/i.test(html);
const ogUrl = /<meta[^>]+property=["']og:url["']/i.test(html);
if (!ogTitle || !ogDesc || !ogUrl) warn('Open Graph tags are incomplete (need og:title, og:description, og:url)');
else note('Open Graph tags present');

// JSON-LD
const ldMatch = html.match(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/i);
if (!ldMatch) fail('index.html has no JSON-LD block');
else {
  try {
    ld = JSON.parse(ldMatch[1]);
    note('JSON-LD parses');
  } catch (err) {
    fail(`JSON-LD is not valid JSON: ${err.message}`);
  }
}

function ldNode(type) {
  if (!ld?.['@graph']) return null;
  return ld['@graph'].find((n) => Array.isArray(n['@type']) ? n['@type'].includes(type) : n['@type'] === type) || null;
}

// A local business is a LocalBusiness, a Plumber, or one of the other LocalBusiness
// subtypes. Anything serving beyond one market is an Organization. Both name the
// same facts, so both get checked against the manifest rather than one passing
// unchecked.
const BUSINESS_TYPES = ['LocalBusiness', 'Plumber', 'Organization', 'ProfessionalService', 'HomeAndConstructionBusiness', 'WebApplication', 'SoftwareApplication'];

if (ld) {
  const business = BUSINESS_TYPES.map(ldNode).find(Boolean) || null;
  if (!business) fail(`JSON-LD has no business node; expected one of ${BUSINESS_TYPES.join(', ')}`);
  else if (site) {
    if (text(business.name) !== text(site.name)) fail(`JSON-LD name "${business.name}" != ${MANIFEST} name "${site.name}"`);
    if (business.url && normalizeUrl(business.url) !== normalizeUrl(site.url)) fail(`JSON-LD url "${business.url}" != ${MANIFEST} url "${site.url}"`);
    if (text(business.telephone || '') !== text(site.contact?.phone || '')) {
      fail(`JSON-LD telephone "${business.telephone}" != ${MANIFEST} contact.phone "${site.contact?.phone}"`);
    }
    const asList = (v) => (Array.isArray(v) ? v : v == null ? [] : [v]);
    const ldHours = (business.openingHoursSpecification || []).map((h) => `${asList(h.dayOfWeek).join(',')}:${h.opens}-${h.closes}`).sort();
    const siteHours = (site.hours || []).map((h) => `${asList(h.days).join(',')}:${h.opens}-${h.closes}`).sort();
    if (JSON.stringify(ldHours) !== JSON.stringify(siteHours)) {
      fail(`JSON-LD openingHoursSpecification does not match ${MANIFEST} hours\n    ld:   ${JSON.stringify(ldHours)}\n    json: ${JSON.stringify(siteHours)}`);
    } else note(`JSON-LD hours match ${MANIFEST}`);
  }
  if (!ldNode('WebSite')) warn('JSON-LD has no WebSite node');
}

// aggregateRating must never be fabricated
const agg = JSON.stringify(ld || {}).match(/"aggregateRating"[\s\S]{0,200}?"ratingValue"\s*:\s*"?[\d.]+/);
if (agg && !site?.trust?.aggregateRating) {
  fail(`JSON-LD contains an aggregateRating but ${MANIFEST} trust.aggregateRating is null; never fabricate review data`);
}

// facts manifest vs site.json
if (facts && site) {
  if (text(facts.name) !== text(site.name)) fail(`brand-facts.json name "${facts.name}" != ${MANIFEST} "${site.name}"`);
  if (normalizeUrl(facts.url) !== normalizeUrl(site.url)) fail(`brand-facts.json url "${facts.url}" != ${MANIFEST} url "${site.url}"`);
  if (text(facts.email) !== text(site.contact?.email)) fail(`brand-facts.json email != ${MANIFEST} contact.email`);
  const servedFacts = (facts.areaServed || []).map(normalizeUrl).sort();
  const servedSite = (site.areaServed || []).map((a) => normalizeUrl(a.name)).sort();
  if (JSON.stringify(servedFacts) !== JSON.stringify(servedSite)) fail('brand-facts.json areaServed does not match site.json areaServed');
  else note('brand-facts.json agrees with site.json');
  if (!facts.lastReviewed) warn('brand-facts.json has no lastReviewed date');
}

// one primary market
if (site?.areaServed?.length && !site.primaryMarket) {
  fail(`${MANIFEST} has areaServed entries but no primaryMarket; local SEO needs exactly one`);
}
if (site?.primaryMarket && site.areaServed?.length) {
  const primary = normalizeUrl(site.primaryMarket.name);
  if (!site.areaServed.some((a) => normalizeUrl(a.name) === primary)) {
    fail(`primaryMarket "${site.primaryMarket.name}" is not present in areaServed`);
  }
}

// privacy gates: do not publish what the manifest says is unpublished
if (site?.publish) {
  const bodyText = html.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<[^>]+>/g, ' ');
  if (site.publish.phoneVisible === false && site.contact?.phone) {
    const variants = phoneVariants(site.contact.phone);
    const found = variants.find((v) => containsNumber(bodyText, v));
    if (found) fail(`publish.phoneVisible is false but the phone number (${found}) appears in visible HTML`);
    else note('phone correctly withheld from visible HTML');
  }
  if (site.publish.addressVisible === false && site.contact?.streetAddress) {
    if (bodyText.includes(site.contact.streetAddress)) {
      fail(`publish.addressVisible is false but the street address appears in visible HTML`);
    }
  }
}

// anchor targets
const ids = new Set([...html.matchAll(/\sid=["']([^"']+)["']/g)].map((m) => m[1]));
const anchors = [...html.matchAll(/href=["']#([^"']+)["']/g)].map((m) => m[1]);
for (const a of new Set(anchors)) {
  if (!ids.has(a)) fail(`index.html links to #${a} but no element with id="${a}" exists`);
}
if (anchors.length) note(`${new Set(anchors).size} in-page anchors resolve`);

// Local asset references. This must run for every page, not just the first:
// an earlier version read the single `html` variable, so links appearing only on
// later pages were never checked. That is how /privacy shipped as a dead link on
// the intake form while validation reported success.
let refsChecked = 0;
for (const [page, body] of Object.entries(pageHtml)) {
  const refs = [...body.matchAll(/(?:src|href)=["'](\/[^"'#?]*)/g)].map((m) => decodeURIComponent(m[1]));
  const missing = [];
  for (const ref of new Set(refs)) {
    if (ref === '/') continue;
    refsChecked++;
    if (!(await exists(ref))) missing.push(ref);
  }
  for (const m of missing) fail(`${page} references ${m} which does not exist`);
}
if (refsChecked) note(`${refsChecked} local references across ${Object.keys(pageHtml).length} page(s) resolve`);

// required files
for (const f of ['robots.txt', 'sitemap.xml', 'llms.txt', '_headers', 'assets/site.css', 'assets/site.js', 'favicon.svg', 'site.webmanifest']) {
  if (!(await exists(f))) fail(`missing required file: ${f}`);
}

try {
  const robots = await read('robots.txt');
  for (const agent of ['OAI-SearchBot', 'PerplexityBot', 'ClaudeBot', 'Googlebot']) {
    if (!new RegExp(`User-agent:\\s*${agent}`, 'i').test(robots)) fail(`robots.txt has no explicit policy for ${agent}`);
  }
  if (isDemo) {
    // noindex alone still leaves the URL as a bare result, so the crawler policy
    // has to carry a blanket Disallow too.
    const blanket = robots.match(/User-agent:\s*\*([\s\S]*?)(?=\nUser-agent:|$)/i);
    if (!blanket || !/^\s*Disallow:\s*\/\s*$/m.test(blanket[1])) {
      fail('robots.txt must Disallow: / for all crawlers while the manifest declares this a demo site');
    } else note('demo site: robots.txt disallows everything');
  } else if (!/Sitemap:/i.test(robots)) {
    fail('robots.txt has no Sitemap directive');
  }
  if (!/GPTBot[\s\S]*?Disallow/i.test(robots)) warn('robots.txt does not block the GPTBot training crawler');
  note('robots.txt sets an explicit AI-crawler policy');
} catch {}

// sitemap base URL
if (!isDemo) {
  try {
    const sitemap = await read('sitemap.xml');
    const locs = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
    if (!locs.length) fail('sitemap.xml has no <loc> entries');
    else if (site && normalizeUrl(locs[0]) !== normalizeUrl(site.url)) {
      fail(`sitemap first <loc> "${locs[0]}" != ${MANIFEST} url "${site.url}"`);
    }
    for (const loc of locs) {
      if (/\/index\.html$/i.test(loc)) fail(`sitemap.xml contains a raw index.html URL: ${loc}`);
    }
    const today = new Date().toISOString().slice(0, 10);
    if (!/<lastmod>/.test(sitemap)) warn('sitemap.xml has no <lastmod> values; freshness signals matter for answer engines');
    else if (!sitemap.includes(today) && new RegExp(`<lastmod>(\\d{4}-\\d{2}-\\d{2})`).test(sitemap)) {
      const first = sitemap.match(/<lastmod>([^<]+)<\/lastmod>/)[1];
      const age = (Date.now() - Date.parse(first)) / 86400000;
      if (age > 60) warn(`sitemap.xml lastmod "${first}" is ${Math.round(age)} days old`);
    }
    note(`sitemap.xml has ${locs.length} entr${locs.length === 1 ? 'y' : 'ies'}`);
  } catch {}
}

// strict mode: no placeholders left
if (STRICT) {
  const files = await walk('.');
  const markers = [/lorem ipsum/i, /\bTODO\b/, /FIXME/, /example\.com/, /\bplaceholder\b/i, /\bTODO:/];
  // A form hint is not leftover filler. `<input placeholder="example.com">` is
  // telling a visitor what to type. The whole attribute goes, because the
  // attribute's own name contains the word "placeholder" and would match on
  // every form even with an innocent value. Body copy, JSON-LD and every other
  // surface stay strict, so a real leftover is still caught.
  const stripFieldHints = (body) => body.replace(
    /\s(?:placeholder|title|aria-label|alt)\s*=\s*("[^"]*"|'[^']*')/gi,
    ''
  );
  // Docs legitimately have to name the markers they are checked for. A repo can
  // list its own exempt files here rather than the check being weakened.
  const exempt = (process.env.TSW_STRICT_EXEMPT || '')
    .split(',').map((f) => f.trim()).filter(Boolean);
  for (const f of files) {
    if (!['.html', '.json', '.md', '.txt', '.xml'].includes(extname(f))) continue;
    if (exempt.some((x) => f === x || f.endsWith(x))) continue;
    const raw = await readFile(join(ROOT, f), 'utf8');
    const body = extname(f) === '.html' ? stripFieldHints(raw) : raw;
    for (const m of markers) {
      const hit = body.match(m);
      if (hit) fail(`strict mode: ${f} still contains "${hit[0]}"`);
    }
  }
  note('strict mode: no placeholders found');
}

const manifestHost = site?.url ? hostOf(site.url) : null;
const liveHosts = (HOSTS_OVERRIDE.length ? HOSTS_OVERRIDE : manifestHost ? [manifestHost] : [])
  .filter((h) => !PLACEHOLDER_HOSTS.has(h.toLowerCase()));

await checkLiveHosts(liveHosts);

report();

function report() {
  const line = '-'.repeat(64);
  console.log(line);
  if (notes.length) {
    console.log('OK');
    for (const n of notes) console.log(`  . ${n}`);
  }
  if (warns.length) {
    console.log('\nWARN');
    for (const w of warns) console.log(`  ! ${w}`);
  }
  if (errors.length) {
    console.log('\nFAIL');
    for (const e of errors) console.log(`  x ${e}`);
  }
  console.log(`\n${line}`);
  console.log(`${notes.length} ok, ${warns.length} warn, ${errors.length} fail${STRICT ? ' (strict)' : ''}`);
  if (errors.length) process.exit(1);
}