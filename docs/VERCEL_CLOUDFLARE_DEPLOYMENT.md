# Vercel and Cloudflare Deployment

This repo is a Vite React app. Vercel should build it with:

- Install command: `npm ci`
- Build command: `npm run build`
- Output directory: `dist`
- Framework preset: `Vite`

The included `vercel.json` keeps those settings explicit, adds SPA rewrites so refreshed client routes serve `index.html`, and gives built assets long-lived immutable caching.

## GitHub Checks

The GitHub Actions workflow in `.github/workflows/build.yml` runs on pushes and pull requests to `main`.

It verifies:

- Dependencies install with `npm ci`
- TypeScript passes with `npm run typecheck`
- ESLint passes with no warnings
- The production build passes with `npm run build`
- `vercel.json` is valid JSON
- `.env.example` exists

Vercel should own deployment through its GitHub integration. That means every push to `main` can deploy production, and pull requests can get Vercel preview deployments, while GitHub Actions provides the quality gate.

## Vercel Setup

1. In Vercel, import or confirm the GitHub repo is connected to the `miragaming-frontend` project.
2. Confirm the project uses the Vite preset and the build settings above.
3. If future environment variables are added, define them in `.env.example` and set the matching values in Vercel Project Settings.
4. Push to `main` and confirm Vercel creates a production deployment.

## Cloudflare Domain Setup

1. In Vercel, open the project and go to Settings -> Domains.
2. Add the apex domain, such as `example.com`, and any preferred subdomain, such as `www.example.com`.
3. In Cloudflare DNS, create the exact DNS records Vercel shows for each domain.
4. Keep Cloudflare proxy status as DNS only until Vercel verifies the domain and issues SSL.
5. After the Vercel certificate is active, Cloudflare SSL/TLS mode can be set to Full (strict).

Vercel's current domain docs say apex domains are configured with an A record, while subdomains use CNAME records. Use the dashboard-provided values if they differ, because Vercel can issue project-specific DNS targets.

## Notes

- Do not commit local `.env` files. This app currently has no required runtime env vars.
- The contact form posts directly to FormSubmit in `src/utils/sendContactEmail.ts`.
- If branch protection is enabled in GitHub, require the `Typecheck, Lint, Build` check before merging to `main`.
