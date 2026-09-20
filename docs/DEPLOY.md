# Deployment

Static site on Cloudflare Pages, served at https://darshan.alokm.com.
Decision context: PLAN.md section 6 (hosting) and open question 2.

## Pages project settings

| Setting | Value |
|---------|-------|
| Project name | `bharat-darshan` (preview URLs: `<branch>.bharat-darshan.pages.dev`) |
| Production branch | `main` |
| Framework preset | Vite (not React: the app is plain JS ES modules, see CLAUDE.md) |
| Build command | `npm run build` |
| Build output directory | `dist` |
| Root directory | `/` |
| Env var `NODE_VERSION` | `22` (package.json requires >= 22.12; Vite 8 needs it) |

`public/_headers` is copied into `dist/` by Vite and sets caching. It relies on two
facts about the code: packs are fetched with `?v=<sha256>` from `manifest.json` (so
`/data/*` is immutable) and the app gunzips `*.bin.gz` itself (so no
`Content-Encoding` is set). There is no `_redirects` file: Pages serves `index.html`
for unknown paths on its own when the build has no `404.html`, which is the SPA
behaviour the router needs. Do not add a `404.html` without adding a rewrite rule.

## Limits to keep in mind

- 25 MiB per file. A single 4096² 16-bit heightmap exceeds this: tile it or move it
  to R2 (see PLAN.md open question 1).
- 20,000 files per deployment.
- 500 builds per month on the free plan. Preview deployments count.

## Setup steps (once)

1. Cloudflare dashboard > Workers & Pages > Create > Pages > Connect to Git.
2. Authorise the Cloudflare Pages GitHub app for `alokmandavgane/bharat-darshan` only.
3. Enter the settings from the table above and save. The first build runs immediately.
   The production branch must contain `package.json` and `vite.config.js`; until the
   build branch is merged into `main`, the production build fails and only branch
   previews work.
4. Custom domains > Set up a custom domain > `darshan.alokm.com`.
   - If `alokm.com` is on Cloudflare DNS, the CNAME and certificate are created
     automatically.
   - Otherwise add `CNAME darshan -> bharat-darshan.pages.dev` at the DNS host, then
     re-check in the dashboard; the certificate issues within a few minutes.
5. Settings > Builds & deployments: enable preview deployments for all branches
   (default). Every pushed branch gets its own URL for review.
6. Optional: Settings > Access policy to put preview URLs behind Cloudflare Access.

## Verifying a deploy

```
curl -sI https://darshan.alokm.com/hi/state/kerala | grep -iE 'HTTP|cache-control'
curl -sI https://darshan.alokm.com/data/manifest.json | grep -i cache-control
```

The first should return 200 with `no-cache`; hashed assets under `/assets/` and
`/data/` should return `immutable`.
