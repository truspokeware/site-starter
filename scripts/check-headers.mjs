#!/usr/bin/env node
// Assert that the security headers in _headers actually reach the browser.
//
// Reading the _headers file proves nothing. Cloudflare Pages honours only the
// last matching block per path, and an earlier version of this template had two
// /* blocks: the file looked complete and every deployed site shipped with no
// CSP at all. This checks the wire.
//
//   node scripts/check-headers.mjs https://my-site.pages.dev
//
// No TSW_BASE or argument means skip, so `npm run check` still works on a machine
// with no network.

const EXPECTED = [
  ['content-security-policy', (v) => /default-src/.test(v)],
  ['strict-transport-security', (v) => /max-age=\d{5,}/.test(v)],
  ['x-content-type-options', (v) => v.toLowerCase().includes('nosniff')],
  ['referrer-policy', (v) => v.length > 0],
  ['x-frame-options', (v) => v.length > 0],
  ['permissions-policy', (v) => v.length > 0]
];

const base = process.argv[2] || process.env.TSW_BASE;

if (!base) {
  console.log('check-headers: no base URL given, skipping (set TSW_BASE or pass a URL)');
  process.exit(0);
}

// Every asset path is a different matching block in _headers, so check the most
// security-relevant responses rather than just the home page.
const PATHS = ['/', '/privacy'];

let failures = 0;
for (const path of PATHS) {
  const url = new URL(path, base).toString();
  let res;
  try {
    res = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(15000) });
  } catch (err) {
    console.error(`FAIL  ${url} did not respond: ${err.message}`);
    failures++;
    continue;
  }
  for (const [header, valid] of EXPECTED) {
    const value = res.headers.get(header);
    if (!value) {
      console.error(`FAIL  ${url} has no ${header}`);
      failures++;
    } else if (!valid(value)) {
      console.error(`FAIL  ${url} has an unusable ${header}: ${value.slice(0, 80)}`);
      failures++;
    }
  }
  if (failures === 0) console.log(`ok    ${url} carries all ${EXPECTED.length} security headers`);
}

if (failures) {
  console.error(`\n${failures} header check(s) failed.`);
  console.error('If the file looks right but these fail, check for more than one matching');
  console.error('path block in _headers. Cloudflare Pages only honours the last one.');
  process.exit(1);
}
console.log('all security headers present');