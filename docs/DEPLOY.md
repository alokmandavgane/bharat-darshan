# Deployment

Static site on Cloudflare Pages, served at https://darshan.alokm.com.
Decision context: PLAN.md section 6 (hosting) and open question 2.

## Pages project settings

| Setting | Value |
|---------|-------|
| Project name | `bharat-darshan` (preview URLs: `<branch>.bharat-darshan.pages.dev`) |
| Production branch | `main` |
| Framework preset | Vite |
| Build command | `npm run build` |
| Build output directory | `dist` |
| Root directory | `/` |
| Env var `NODE_VERSION` | current LTS, e.g. `22` |

`public/_headers` and `public/_redirects` are copied into `dist/` by Vite and
configure caching, pre-gzipped binaries and SPA routing. Keep them in sync with the
data pipeline's output names (`*.bin.gz` under `public/data/`).

## Limits to keep in mind

- 25 MiB per file. A single 4096² 16-bit heightmap exceeds this: tile it or move it
  to R2 (see PLAN.md open question 1).
- 20,000 files per deployment.
- 500 builds per month on the free plan. Preview deployments count.

## Setup steps (once)

1. Cloudflare dashboard > Workers & Pages > Create > Pages > Connect to Git.
2. Authorise the Cloudflare Pages GitHub app for `alokmandavgane/bharat-darshan` only.
3. Enter the settings from the table above and save. The first build runs immediately.
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
