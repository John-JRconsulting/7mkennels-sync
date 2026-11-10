# 7mkennels-sync

Every 5 minutes, a Vercel cron (project `7mkennels-sync`, John Ritchie Consulting team) calls `api/sync.js`. It reads the head of `main` in https://github.com/7mkennels/website, and when that commit is not live yet it publishes `public/` to the `7mkennels` Vercel project, which serves https://7mkennels.com.

To see which commit is live, open https://7mkennels.com/deployed.json.

Environment (production): `VERCEL_TOKEN` (JRC-scoped token) and `CRON_SECRET`. This runs until the site moves to Cloudflare in January 2027; then delete the `7mkennels-sync` Vercel project and revoke the token.
