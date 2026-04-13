# Design System + Storybook

A Next.js design system with a custom Storybook Design Panel that lets the team inspect, live-edit, and PR design tokens and component variants.

## Local development

```bash
npm install
npm run storybook   # http://localhost:6006  (full save/PR flow via local filesystem)
npm run dev         # http://localhost:3000  (Next.js app preview)
```

The Storybook Design Panel talks to a local Vite plugin (`/.storybook/vite-context-plugin.ts`) that reads/writes `app/globals.css`, story files, and `.meta.json` files directly on disk.

## Hosted Storybook on Vercel (team-wide)

The static Storybook is deployed alongside the Next.js app on Vercel. All save/PR operations route to Next.js API routes (`/api/tokens`, `/api/story-args`, `/api/layer-names`, `/api/add-story`, `/api/create-pr`) which use the GitHub Contents API instead of the local filesystem.

### Required environment variables (set in Vercel dashboard)

| Variable | Description |
|---|---|
| `GITHUB_TOKEN` | Personal access token (or fine-grained token) with `contents:write` and `pull_requests:write` on this repo |
| `GITHUB_OWNER` | GitHub org or username (e.g. `denis-keye`) |
| `GITHUB_REPO` | Repository name (e.g. `StorybookTest`) |
| `GITHUB_BRANCH` | Base branch to branch from and target PRs at (default: `main`) |
| `STORYBOOK_API_BASE` | Full URL of the Vercel deployment (e.g. `https://my-app.vercel.app`) — baked into the static Storybook build so the panel knows where to send API calls |

### Deploy

```bash
npm run build-storybook   # outputs to storybook-static/
# Vercel picks this up automatically via the build command
```

The Vercel build command should be:
```
npm run build && npm run build-storybook
```

Output directory: `.next` (Next.js handles the routing; Storybook static files are served from `/storybook-static` via a rewrite or as a separate static site).

### How saves work in hosted mode

1. User opens `https://your-vercel-url/storybook-static/index.html`
2. They live-edit a token or text in the Design Panel
3. Hitting **↑ Save** calls `POST /api/tokens` → GitHub Contents API → commits to `design/<token-id>` branch
4. **⤴ PR** opens a pull request from that branch targeting `main`

Each unique `GITHUB_TOKEN` gets its own `design/<last-8-chars>` working branch, so multiple team members can work simultaneously without conflicts.
