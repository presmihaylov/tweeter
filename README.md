# birdtui

Local Twitter/X TUI launched with `bird`, built with Bun, TypeScript, and OpenTUI.

## Quick start

```bash
bun install
bun run check
bun run build
bun run dev
```

On first run, birdtui imports `~/.config/birdgo/config.json` when present. Otherwise it opens an onboarding screen explaining how to paste `auth_token` and `ct0` cookies.

## Commands

- `bun run dev` — run the TUI from source
- `bun run build` — build `dist/cli.js` with bin name `bird`
- `bun run test` — unit/integration tests with mocked network
- `bun run typecheck` — TypeScript strict mode
- `bun run lint` — ESLint strict rules, including no explicit `any`
- `bun run check` — typecheck + lint + tests

## Useful env vars

- `BIRDTUI_CONFIG_DIR` — override config dir for tests/dev
- `BIRDTUI_CACHE_DIR` — override cache dir for tests/dev
- `BIRDTUI_IMAGE_RENDERER=auto|chafa|kitty|none`

## MVP status

Implemented:

- Bun/TypeScript project + `bird` executable
- OpenTUI terminal shell with feed/detail/replies/composer state
- first-run onboarding/instructions
- import from birdgo config
- local config/cache stores with zod validation
- Twitter/X auth check, home timeline, tweet detail/replies, reply/create tweet
- query ID cache/fallback/discovery scaffolding
- tweet/media/cursor extraction from GraphQL timeline instructions
- chafa media preview helper + external open/copy helpers
- normalized state reducer/store helpers
- mocked e2e tests for config import, auth headers, extraction, timelines, replies, posting, media helpers

Live X private API can still break when operation IDs or response shapes change; query ID refresh and tests are set up to make those failures visible.
