#!/usr/bin/env node
import { readFile, stat, readdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const KIT = join(ROOT, 'vendor/tsw-kit');

const fails = [];
const ok = (m) => console.log(`  . ${m}`);
const fail = (m) => { fails.push(m); console.log(`  x ${m}`); };

const exists = async (p) => { try { await stat(p); return true; } catch { return false; } };

if (!(await exists(KIT))) {
  console.error('vendor/tsw-kit is missing. Run: npm run sync:kit');
  process.exit(1);
}

for (const f of ['index.js', 'theme.css', 'components.css', 'LICENSE', 'NOTICE.md', 'VERSION']) {
  if (!(await exists(join(KIT, f)))) fail(`vendor/tsw-kit/${f} is missing`);
}
ok('vendored kit files present');

const version = (await readFile(join(KIT, 'VERSION'), 'utf8')).trim();
ok(`vendored kit version ${version}`);

const notice = await readFile(join(KIT, 'NOTICE.md'), 'utf8');
if (!notice.includes('MIT')) fail('vendor/tsw-kit/NOTICE.md does not state the MIT licence');
else ok('Tabler MIT notice retained in the vendored copy');

const { ICON_NAMES } = await import(`file://${join(KIT, 'icons/icons.js')}`);
ok(`${ICON_NAMES.length} icons in the vendored registry`);

const html = await readFile(join(ROOT, 'index.html'), 'utf8');
const usesIcons = /<tsw-icon/.test(html);
if (usesIcons) {
  const used = [...html.matchAll(/<tsw-icon[^>]*name="([^"]+)"/g)].map((m) => m[1]);
  const unknown = [...new Set(used)].filter((n) => !ICON_NAMES.includes(n));
  if (unknown.length) fail(`index.html uses icons missing from the kit: ${unknown.join(', ')}`);
  else ok(`all ${new Set(used).size} icons used by index.html exist in the kit`);
}

const css = await readFile(join(KIT, 'components.css'), 'utf8');
if (!css.includes('form[is~="tsw-form"]')) fail('components.css lost the customized-built-in form selectors');
else ok('form selectors intact');

if (css.includes('.form[is~=')) fail('components.css contains corrupted ".form[is~=" selectors');
else ok('no corrupted selectors');

const braces = (s) => s.split('{').length - 1 === s.split('}').length - 1;
for (const f of ['theme.css', 'components.css']) {
  const body = await readFile(join(KIT, f), 'utf8');
  if (!braces(body)) fail(`${f} has unbalanced braces`);
}
ok('css braces balanced');

const componentsDir = join(KIT, 'components');
const HELPERS = new Set(['shared.js']);
const modules = (await readdir(componentsDir)).filter((f) => f.endsWith('.js') && !HELPERS.has(f));
for (const m of modules) {
  const body = await readFile(join(componentsDir, m), 'utf8');
  if (!body.includes('customElements.define')) fail(`components/${m} never registers an element`);
}
const helpers = (await readdir(componentsDir)).filter((f) => f.endsWith('.js') && HELPERS.has(f));
if (helpers.length) ok(`${modules.length} component modules register elements, ${helpers.length} helper module(s)`);
else ok(`${modules.length} component modules register elements`);

console.log(`\n${fails.length ? `${fails.length} kit check failures` : 'kit checks passed'}`);
if (fails.length) process.exit(1);
