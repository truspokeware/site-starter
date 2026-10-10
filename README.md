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

## 0.3.0

- `contact` and `hours` are optional manifest keys, so a site with neither, such
  as a utility, does not have to write nulls to satisfy the validator
- `WebApplication` and `SoftwareApplication` accepted as JSON-LD types
- Browser checks discover the form rather than naming a route, tolerate a form
  with no branching fieldsets, and assert only that contact links are well formed
- The check server resolves directory routes, so `/guides/` serves index.html
- `sync:kit` finds the kit from `utilities/<name>/` as well as the workspace root

## 0.2.0

- Multi-page validation via `--pages=`, including per-page meta descriptions and
  per-page local reference checking
- Live host and soft-404 checks, with hosts derived from the manifest rather
  than hardcoded, and skipped on CI where runner IPs are edge-blocked
- `Organization`, `ProfessionalService` and `HomeAndConstructionBusiness`
  accepted as business JSON-LD types
- `primaryMarket` and `areaServed` required only when `areaServed` is present
- A `demo` declaration inverts the indexing rules: noindex required, blanket
  `Disallow: /` required, sitemap checks skipped

## Multi-page and non-local sites

`npm run validate` takes `--pages=index.html,privacy.html` and checks every page
listed, not only the first. This matters more than it looks: an earlier version
read one `html` variable, so a link appearing only on a later page was never
checked. That is how `/privacy` shipped as a dead link on a form while validation
reported success.

The live host check derives its hosts from `assets/site.json` `url`, so the same
file works for an apex domain, a subdomain, or a Pages project without editing.
Pass `--hosts=a.example.com,b.example.com` when a site answers on more than one,
and `TSW_SKIP_LIVE=1` to skip the network entirely. It is skipped automatically
on CI, because GitHub's runner IPs are edge-blocked by bot protection.

### Not every site is local

`primaryMarket` and `areaServed` are required **only when `areaServed` is
present**, so a site with no defined service area is a valid site rather than a
broken one. The one-primary-market rule is unchanged for sites that do have one.

The JSON-LD check accepts `Organization`, `ProfessionalService`,
`HomeAndConstructionBusiness` alongside `LocalBusiness` and `Plumber`. Whichever
is used, its `name`, `url`, `telephone` and `openingHoursSpecification` are still
cross-checked against the manifest. The `aggregateRating` fabrication guard is
not affected by this and still fails.

### Demonstration sites

A fictional or demonstration site must not compete with a real client for the
same local queries. Declare it in `assets/site.json`, which inverts the indexing
rules rather than weakening them:

```json
"demo": {
  "isSample": true,
  "note": "Fictional business used to demonstrate the template. The phone number, email domain and address are placeholders. Do not call it."
}
```

`"demo": true` also works. Prefer the object, because the note is a business fact
and belongs in the manifest with the rest of them. Either form means:

- `noindex` becomes **required** instead of forbidden
- `robots.txt` must carry a blanket `Disallow: /`, so the URL does not appear as
  a bare result
- the sitemap checks are skipped, because a noindex site should not advertise one

Nothing else changes. Every manifest cross-check still applies, so a demo site
cannot carry a fact the manifest does not.

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
