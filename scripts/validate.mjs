#!/usr/bin/env node
import { readFile, readdir, stat } from 'node:fs/promises';
import { join, dirname, relative, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const STRICT = process.env.TSW_STRICT === '1';

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
  const clean = p.replace(/^\/+|\/+$/g, '');
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

async function walk(dir, out = []) {
  for (const entry of await readdir(join(ROOT, dir), { withFileTypes: true })) {
    // `.lighthouseci` holds generated HTML reports that quote these very markers
    // from Lighthouse's own output, so walking it produces false positives.
    if (['node_modules', '.git', '.lighthouseci', 'vendor', '.wrangler'].includes(entry.name)) continue;
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

// ---------------------------------------------------------------------------

const REQUIRED_SITE_KEYS = ['name', 'url', 'description', 'category', 'primaryMarket', 'areaServed', 'contact', 'hours', 'publish'];

let site = null;
let html = '';
let facts = null;
let ld = null;

try {
  site = JSON.parse(await read('assets/site.json'));
  note('assets/site.json parses');
} catch (err) {
  fail(`assets/site.json is not valid JSON: ${err.message}`);
}

try {
  html = await read('index.html');
  note('index.html reads');
} catch {
  fail('index.html is missing');
}

try {
  facts = JSON.parse(await read('.well-known/brand-facts.json'));
  note('.well-known/brand-facts.json parses');
} catch (err) {
  fail(`.well-known/brand-facts.json is not valid JSON: ${err.message}`);
}

if (site) {
  for (const key of REQUIRED_SITE_KEYS) {
    if (!(key in site)) fail(`assets/site.json is missing required key "${key}"`);
  }
  if (site.url && !/^https:\/\//.test(site.url)) fail(`assets/site.json url must be https, got "${site.url}"`);
  if (site.description && site.description.length > 300) {
    warn(`assets/site.json description is ${site.description.length} chars; keep it under 300`);
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
  fail(`canonical "${canonical[1]}" does not match site.json url "${site.url}"`);
} else note(`canonical matches site.json url (${canonical?.[1]})`);

const desc = html.match(/<meta[^>]+name=["']description["'][^>]*content=["']([^"']*)["']/i);
if (!desc) fail('index.html is missing a meta description');
else {
  const len = desc[1].length;
  if (len < 70) fail(`meta description is only ${len} chars; aim for 110-160`);
  else if (len > 175) warn(`meta description is ${len} chars; Google truncates past roughly 160`);
  else note(`meta description is ${len} chars`);
}

if (/<meta[^>]+name=["']robots["'][^>]*content=["'][^"']*noindex/i.test(html)) {
  fail('index.html sets a noindex directive');
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

if (ld) {
  const local = ldNode('LocalBusiness') || ldNode('Plumber');
  if (!local) fail('JSON-LD has no LocalBusiness or Plumber node');
  else if (site) {
    if (text(local.name) !== text(site.name)) fail(`JSON-LD name "${local.name}" != site.json name "${site.name}"`);
    if (local.url && normalizeUrl(local.url) !== normalizeUrl(site.url)) fail(`JSON-LD url "${local.url}" != site.json url "${site.url}"`);
    if (text(local.telephone || '') !== text(site.contact?.phone || '')) {
      fail(`JSON-LD telephone "${local.telephone}" != site.json contact.phone "${site.contact?.phone}"`);
    }
    const asList = (v) => (Array.isArray(v) ? v : v == null ? [] : [v]);
    const ldHours = (local.openingHoursSpecification || []).map((h) => `${asList(h.dayOfWeek).join(',')}:${h.opens}-${h.closes}`).sort();
    const siteHours = (site.hours || []).map((h) => `${asList(h.days).join(',')}:${h.opens}-${h.closes}`).sort();
    if (JSON.stringify(ldHours) !== JSON.stringify(siteHours)) {
      fail(`JSON-LD openingHoursSpecification does not match site.json hours\n    ld:   ${JSON.stringify(ldHours)}\n    json: ${JSON.stringify(siteHours)}`);
    } else note('JSON-LD hours match site.json');
  }
  if (!ldNode('WebSite')) warn('JSON-LD has no WebSite node');
}

// aggregateRating must never be fabricated
const agg = JSON.stringify(ld || {}).match(/"aggregateRating"[\s\S]{0,200}?"ratingValue"\s*:\s*"?[\d.]+/);
if (agg && !site?.trust?.aggregateRating) {
  fail('JSON-LD contains an aggregateRating but site.json trust.aggregateRating is null; never fabricate review data');
}

// facts manifest vs site.json
if (facts && site) {
  if (text(facts.name) !== text(site.name)) fail(`brand-facts.json name "${facts.name}" != site.json "${site.name}"`);
  if (normalizeUrl(facts.url) !== normalizeUrl(site.url)) fail(`brand-facts.json url "${facts.url}" != site.json "${site.url}"`);
  if (text(facts.email) !== text(site.contact?.email)) fail(`brand-facts.json email != site.json contact.email`);
  const servedFacts = (facts.areaServed || []).map(normalizeUrl).sort();
  const servedSite = (site.areaServed || []).map((a) => normalizeUrl(a.name)).sort();
  if (JSON.stringify(servedFacts) !== JSON.stringify(servedSite)) fail('brand-facts.json areaServed does not match site.json areaServed');
  else note('brand-facts.json agrees with site.json');
  if (!facts.lastReviewed) warn('brand-facts.json has no lastReviewed date');
}

// one primary market
if (site?.areaServed?.length && !site.primaryMarket) {
  fail('site.json has areaServed entries but no primaryMarket; local SEO needs exactly one');
}
if (site?.primaryMarket && site.areaServed?.length) {
  const primary = normalizeUrl(site.primaryMarket.name);
  if (!site.areaServed.some((a) => normalizeUrl(a.name) === primary)) {
    fail(`primaryMarket "${site.primaryMarket.name}" is not present in areaServed`);
  }
}

// privacy gates: do not publish what site.json says is unpublished
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
      fail('publish.addressVisible is false but the street address appears in visible HTML');
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

// local asset references
const localRefs = [...html.matchAll(/(?:src|href)=["'](\/[^"'#?]*)/g)].map((m) => m[1]);
const missing = [];
for (const ref of new Set(localRefs)) {
  const p = decodeURIComponent(ref);
  if (p === '/') continue;
  if (!(await exists(p))) missing.push(p);
}
for (const m of missing) fail(`index.html references ${m} which does not exist`);

// required files
for (const f of ['robots.txt', 'sitemap.xml', 'llms.txt', '_headers', 'assets/site.css', 'assets/site.js', 'favicon.svg', 'site.webmanifest']) {
  if (!(await exists(f))) fail(`missing required file: ${f}`);
}

try {
  const robots = await read('robots.txt');
  for (const agent of ['OAI-SearchBot', 'PerplexityBot', 'ClaudeBot', 'Googlebot']) {
    if (!new RegExp(`User-agent:\\s*${agent}`, 'i').test(robots)) fail(`robots.txt has no explicit policy for ${agent}`);
  }
  if (!/Sitemap:/i.test(robots)) fail('robots.txt has no Sitemap directive');
  if (!/GPTBot[\s\S]*?Disallow/i.test(robots)) warn('robots.txt does not block the GPTBot training crawler');
  note('robots.txt sets an explicit AI-crawler policy');
} catch {}

// sitemap base URL
try {
  const sitemap = await read('sitemap.xml');
  const locs = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  if (!locs.length) fail('sitemap.xml has no <loc> entries');
  else if (site && normalizeUrl(locs[0]) !== normalizeUrl(site.url)) {
    fail(`sitemap first <loc> "${locs[0]}" != site.json url "${site.url}"`);
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

// strict mode: no placeholders left
if (STRICT) {
  const files = await walk('.');
  const markers = [/lorem ipsum/i, /\bTODO\b/, /FIXME/, /example\.com/, /\bplaceholder\b/i, /\bTODO:/];
  // Docs legitimately have to name the markers they are checked for. A repo can
  // list its own exempt files here rather than the check being weakened.
  const exempt = (process.env.TSW_STRICT_EXEMPT || '')
    .split(',').map((f) => f.trim()).filter(Boolean);
  for (const f of files) {
    if (!['.html', '.json', '.md', '.txt', '.xml'].includes(extname(f))) continue;
    if (f.includes('site-starter')) continue;
    if (exempt.some((x) => f === x || f.endsWith(x))) continue;
    const body = await readFile(join(ROOT, f), 'utf8');
    for (const m of markers) {
      const hit = body.match(m);
      if (hit) fail(`strict mode: ${f} still contains "${hit[0]}"`);
    }
  }
  note('strict mode: no placeholders found');
}

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
