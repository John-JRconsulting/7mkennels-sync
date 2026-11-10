# 7mkennels-sync

Every 5 minutes, a GitHub Action checks https://github.com/7mkennels/website. When `main` has a commit that is not live yet, it publishes `public/` to the `7mkennels` Vercel project (John Ritchie Consulting team), which serves https://7mkennels.com.

To see which commit is live, open https://7mkennels.com/deployed.json.

The Vercel token is the repository secret `VERCEL_TOKEN`. This runs until the site moves to Cloudflare in January 2027; then disable the workflow and revoke the token.
