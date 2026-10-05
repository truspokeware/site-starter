#!/usr/bin/env node
import { cp, mkdir, readFile, rm, writeFile, stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DEST = join(ROOT, 'vendor/tsw-kit');

const arg = (name) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split('=').slice(1).join('=') : undefined;
};

const exists = async (p) => {
  try { await stat(p); return true; } catch { return false; }
};

async function versionFrom(source) {
  const pkg = join(source, 'package.json');
  if (await exists(pkg)) {
    const { version } = JSON.parse(await readFile(pkg, 'utf8'));
    return version;
  }
  const tabler = join(source, 'icons/.tabler-version');
  if (await exists(tabler)) return (await readFile(tabler, 'utf8')).trim();
  return 'unknown';
}

async function main() {
  const source = arg('from') || process.env.TSW_KIT_SRC || resolve(ROOT, '..', 'tsw-kit');
  const src = resolve(source);

  if (!(await exists(join(src, 'index.js')))) {
    console.error(`No tsw-kit found at ${src}`);
    console.error('Pass --from=/path/to/tsw-kit or set TSW_KIT_SRC.');
    process.exit(1);
  }

  await rm(DEST, { recursive: true, force: true });
  await mkdir(DEST, { recursive: true });

  for (const entry of ['index.js', 'theme.css', 'components.css', 'LICENSE', 'NOTICE.md']) {
    await cp(join(src, entry), join(DEST, entry));
  }
  await cp(join(src, 'components'), join(DEST, 'components'), { recursive: true });
  await cp(join(src, 'icons'), join(DEST, 'icons'), { recursive: true });

  const version = arg('version') || (await versionFrom(src));
  await writeFile(join(DEST, 'VERSION'), `${version}\n`, 'utf8');

  const icons = (await import(join(DEST, 'icons/icons.js').replace(/^/, 'file://'))).ICON_NAMES.length;
  console.log(`Vendored tsw-kit ${version} from ${src}`);
  console.log(`  ${icons} icons -> ${DEST}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
