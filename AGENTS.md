# site-starter

The template every client site is generated from. Conventions live in the
workspace `AGENTS.md`; this is the client-site subset.

## Hard rules

1. **Never hand-edit `vendor/tsw-kit/`.** Run `npm run sync:kit`.
2. **Business facts live only in `assets/site.json`.** Every other surface,
   including JSON-LD, `brand-facts.json`, the rendered text and the sitemap, is
   checked against it by `npm run validate`.
3. **Never invent a fact.** No phone number, address, hours, licence number,
   testimonial or review score that is not in the manifest. `publish.*Visible`
   gates are enforced against the rendered page, not just the markup.
4. **Keep the no-JavaScript path working.** CI runs the whole site twice, once
   with JavaScript disabled, and asserts the content, the styling and a real
   form submission still work.
5. **One `<h1>`, real landmarks, `<form is="tsw-form">` for anything submitted.**
6. **One primary market.** `areaServed` lists the rest. Two primary markets
   splits local rankings and reads as careless. A site with no `areaServed` has
   no primary market, and that is valid.
7. **`demo: true` in the manifest for any fictional or demonstration site.** It
   makes noindex and a blanket `Disallow: /` mandatory. It relaxes nothing else.

## Changing the template

Changes here propagate to every future client site, so raise the bar.

- Bump `package.json` version.
- Run `npm run check` and `npm run lighthouse`. All four Lighthouse categories
  must stay at 100 and total page weight must stay under 500 KB.
- Update the root `docs/decisions.md` if the change reflects a decision.

## New client site

```bash
gh repo create truspokeware/clients/<slug> --private --template truspokeware/site-starter
npm run sync:kit
$EDITOR assets/site.json          # the only file that needs real content
$EDITOR assets/site.css          # accent colour pair
npm run validate                 # must pass before anything is deployed
```

Then set the custom domain in Cloudflare, point nameservers, and enable
Cloudflare Access on preview deployments only. Production stays public.
