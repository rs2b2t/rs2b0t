# 2004bot.com — rs2b0t showcase site

**Date:** 2026-07-21
**Status:** Approved design, pre-implementation

## Goal

A static showcase site for rs2b0t at **https://2004bot.com**, visually matching
rs2b2t.com's 2004-era style. Branding is **rs2b0t** (the gold logo says rs2b0t;
2004bot.com is just the address). Hosted on Cloudflare Pages; code lives in this
repo under `site/`; the Cloudflare zone/project live in rs2b2t's Terraform.

## Pages

All pages share the rs2b2t visual language: black background, tiled stone
`background.jpg`, gold Times-italic logo, stone-button links with red/grey glow
hovers, 13px Arial body, table-centered layout.

1. **`/` (landing)**
   - Hero: gold **rs2b0t** logo + pitch line: "a scriptable, direct-input bot
     client for rs2b2t".
   - Six highlight blurbs (from README): typed scripting API, bot base classes,
     world-walking, real client / no forged packets, in-client panel,
     out-of-tree scripts.
   - One real client screenshot (curated from `out/`, e.g. `paint-overview.png`
     or `paint-ardyfighter.png`).
   - Short TypeScript bot snippet in a code block.
   - Three stone-button CTAs: **Run it** → https://w1.rs2b2t.com/rs2b0t,
     **API docs** → `/docs/api`, **Source** → https://github.com/rs2b2t/rs2b0t.
2. **`/docs/api`** — `docs/API.md` rendered to HTML in the site chrome.
3. **`/docs/dev`** — `docs/DEV.md` rendered the same way.
4. **`/disclaimer`** — Jagex non-affiliation (mirroring rs2b2t.com's), plus an
   explicit paragraph: rs2b0t is built for rs2b2t, where botting is allowed; it
   is **not** for use on the moderated Lost City server (2004.lostcity.rs).

Every page footer links to `/disclaimer` and credits the Lost City project
(same homage treatment as rs2b2t.com).

## Build & code structure

```
site/
  build.ts               # generator: layout() + page renderers + asset copy → dist/
  pages/index.ts         # landing-page body HTML
  pages/disclaimer.ts    # disclaimer body HTML
  static/img/...         # 2004-style assets copied once from rs2b2t/site/static
  static/screenshot-*.png  # curated client screenshot(s)
  dist/                  # build output (git-ignored)
```

- `bun run site/build.ts` renders all four pages into `site/dist/` as plain
  HTML + images. Wired up as a `site:build` package.json script.
- `layout()` is a trimmed adaptation (a deliberate copy, not an import) of
  rs2b2t `site/src/layout.ts` — same CSS classes and glow-button script,
  rs2b0t logo text, its own footer.
- Docs pages are rendered from `../docs/API.md` and `../docs/DEV.md` at build
  time using `marked`. Headings get anchor ids so API sections are linkable.
  Rendering from the repo's own markdown at build time is what prevents
  site/docs drift.
- No bundler, no framework, no client-side JS beyond the existing hover-glow
  snippet — viewable in a 2004 browser, which is on-theme.

## Infra & deploy

- **Terraform** (in rs2b2t repo, `infra/cloudflare-2004bot.tf`):
  - `cloudflare_zone` for 2004bot.com — **imported** (Cloudflare Registrar
    already created the zone in the account), never created fresh.
  - `cloudflare_pages_project` named `2004bot`.
  - Custom-domain attachment for `2004bot.com`; proxied CNAME apex →
    the project's `pages.dev` host; `www` → apex redirect via ruleset.
  - House rules apply: `make plan` first, then targeted
    `tf.sh apply -target=...` only. Never a blind apply.
- **Deploy:** `tools/deploy-site.sh` in this repo — runs the build, then
  `wrangler pages deploy site/dist --project-name 2004bot`, sourcing the
  Cloudflare API token from `~/code/claude-workspace/.env`. Re-deploy =
  re-run. No game infra is touched.

## Verification

- Build, serve `dist/` locally, eyeball all four pages against rs2b2t.com for
  style fidelity.
- After first deploy: `curl -I https://2004bot.com` → 200; spot-check docs
  pages and image loads over the live domain.
- No automated tests beyond the build succeeding; the failure mode that
  matters (docs drift) is eliminated by build-time rendering.

## Explicitly out of scope

- Serving or proxying the actual bot client from 2004bot.com (it stays at
  w1.rs2b2t.com/rs2b0t).
- Accounts, hiscores, or any dynamic/server-rendered features.
- Any change to rs2b2t game infrastructure.
