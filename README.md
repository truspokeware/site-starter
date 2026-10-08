# site-starter

The template every TruSpokeWare client site is generated from. No build step.
Plain HTML, CSS and ES modules.

```bash
npm install
npm run sync:kit     # vendor the current tsw-kit into vendor/
npm run check        # kit integrity, facts manifest, browser checks, axe
npm run lighthouse   # performance and accessibility budgets
```

## What is here

| Path | Purpose |
|---|---|
| `index.html` | The whole site. Real content in real HTML |
| `assets/site.json` | **The only source of business truth** |
| `assets/site.css` | Client accent and any bespoke styling |
| `scripts/validate.mjs` | Enforces that every other surface agrees with the manifest |
| `scripts/check-kit.mjs` | Checks the vendored kit is complete and referenced icons exist |
| `test/browser-checks.mjs` | Behaviour, computed styles, axe, and a full no-JavaScript pass |
| `vendor/tsw-kit/` | Pinned copy of the kit. Never hand-edit |
| `_headers` | Cache policy, CSP, security headers |

## The idea

Everything renders correctly with JavaScript disabled, and CI proves it by
loading the site twice. Content is in the HTML, components add behaviour, and
the form is a real `<form>` that posts to the server whether or not the module
loads.

`TSW_STRICT=1 npm run validate` additionally fails on leftover placeholders.
That is how client repositories are checked. The template itself is full of
deliberate placeholders, so it must not be run in strict mode.

A client repo whose README has to name the marker list can exempt just that file
with `TSW_STRICT_EXEMPT=README.md`, rather than weakening the check for the
whole repository.

## Current state

Validated, and passing: 45 browser checks including a complete no-JavaScript
pass, zero axe violations at any severity, HTML validation clean, and Lighthouse
100 / 100 / 100 / 100 at 30 KiB total.

## Required before a client site goes live

- **`404.html` must exist.** Without it, Pages serves `index.html` for any
  unmatched path, so every dead link returns 200 and search engines index
  duplicate URLs. CI fails if the file is missing.
- **`privacy.html` and a nav link to it.** A contact form collecting personal
  details needs to say what happens to them.
- **`assets/site.json` fully populated**, with `publish.*Visible` set honestly.
  Validation cross-checks every other surface against it, including a live check
  that the phone number does not appear when `phoneVisible` is false.

## New client site

See `AGENTS.md`.
