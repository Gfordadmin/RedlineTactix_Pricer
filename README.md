# Redline Tactix Pricer — Cloudflare Workers + GitHub + Claude (all cloud)

Starter project. Nothing runs on a local Mac: the code lives in GitHub,
Claude works on it from GitHub Actions, and Cloudflare serves it.

## How the pieces connect

1. **GitHub** holds the code. This repo.
2. **Claude** builds in the cloud. Mention `@claude` in any issue or PR
   comment and the workflow in `.github/workflows/claude.yml` runs Claude
   Code on GitHub Actions. It reads the repo, makes changes, and opens a
   pull request for review.
3. **Cloudflare** runs the app. The Worker in `src/index.js` deploys with
   Wrangler, and the repo can be connected to Cloudflare Workers so every
   push to `main` auto-deploys.

## Setup still needed (one time)

1. **Claude credentials** — in the GitHub repo, go to Settings → Secrets
   and variables → Actions, and add one of these:
   - `ANTHROPIC_API_KEY` — an Anthropic API key (pay-per-use), or
   - `CLAUDE_CODE_OAUTH_TOKEN` — a token from a Claude Pro/Max
     subscription (run `claude setup-token` once in a terminal where
     Claude Code is installed, or generate it from claude.ai settings).
   The workflow uses the API key by default; comment out that line and
   uncomment the OAuth line to use the subscription token instead.
2. **Cloudflare deploy** — connect this repo in the Cloudflare dashboard
   (Workers & Pages → Create → Connect to Git) for auto-deploys, or run
   `npx wrangler deploy` after `npx wrangler login`.

## Local development (optional)

```sh
npm install
npm run dev     # local Worker at http://localhost:8787
npm run deploy  # deploy to Cloudflare
```

## How to ask Claude to build something

Open an issue in the repo describing what the pricer should do — what it
prices, what inputs it takes, what the output looks like — tag `@claude`,
and it will propose the change as a pull request. Review, merge, and
Cloudflare deploys it.
