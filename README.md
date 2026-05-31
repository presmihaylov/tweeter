# birdtui

Local Twitter/X TUI launched with `bird`, built with Bun, TypeScript, and OpenTUI.

## How it works

Reads (timeline, tweet detail, replies, mentions) go through X's private GraphQL endpoints using your browser cookies — same approach as the [`birdgo`](https://github.com/presmihaylov/birdgo) CLI. No API quota, free.

Writes (reply, new tweet) go through the **official X v2 API** with an OAuth 2.0 PKCE token. This is the cost-safe path: replies via cookies trigger ban heuristics; replies via the official API don't. You pay per post (~$0.015/text, ~$0.20/post-with-URL on pay-per-use).

## Quick start

```bash
bun install
bun run check
bun run build
bun run dev
```

On first run, birdtui imports `~/.config/birdgo/config.json` when present. Otherwise it opens an onboarding screen explaining how to paste `auth_token` and `ct0` cookies.

To enable replies and new tweets, you also need to connect the official X API once:

```bash
bird auth twitter --client-id <your-oauth2-client-id>
```

This opens your browser, walks through X's OAuth 2.0 PKCE flow, and saves the access + refresh tokens to your birdtui profile. Tokens auto-refresh as they expire.

### Creating an X developer app

1. Sign in at <https://developer.x.com> with the X account you want to post from.
2. Create a Project, then create an App inside it. v2 write endpoints require apps attached to a Project.
3. In the App's "User authentication settings":
   - Set **App permissions** to **Read and write** (writes need this even for OAuth 2.0).
   - Enable **OAuth 2.0**.
   - **Type of App**: Native App (Public Client). PKCE is required; no client secret.
   - **Callback URI / Redirect URL**: `http://127.0.0.1/callback` (any port; birdtui binds a random local port and uses the path `/callback`). If your portal requires an explicit port, register `http://127.0.0.1:8765/callback` and run `bird auth twitter --port 8765`.
4. Copy the **Client ID** from the app's "Keys and tokens" tab. That's the value you pass to `--client-id`.
5. Pay-per-use is the default tier as of 2026. Confirm billing is set up — at $0.015 per text post / $0.20 per URL-bearing post, ~50 replies/day is roughly $20–$30/mo.

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

## CLI flags

```
bird [--profile name] [--renderer auto|chafa|kitty|none] [--debug-log path]
bird --check-auth [--profile name]
bird --set-cookie-header 'name=value; ...' [--profile name]
bird --reset-auth
bird auth twitter --client-id <id> [--profile name] [--port N] [--no-browser]
```

## MVP status

Implemented:

- Bun/TypeScript project + `bird` executable
- OpenTUI terminal shell with feed/detail/replies/composer state
- first-run onboarding/instructions
- import from birdgo config
- local config/cache stores with zod validation
- X cookie auth check, home timeline, tweet detail/replies via GraphQL
- **Official X v2 API client for replies and new tweets, OAuth 2.0 PKCE flow via `bird auth twitter`, auto refresh**
- query ID cache/fallback/discovery scaffolding (reads only)
- tweet/media/cursor extraction from GraphQL timeline instructions
- chafa media preview helper + external open/copy helpers
- normalized state reducer/store helpers
- mocked tests for config import, auth headers, extraction, timelines, replies, OAuth flow, write client, media helpers

Live X GraphQL endpoints can still break when operation IDs or response shapes change; query ID refresh and tests are set up to make those failures visible. Writes use the supported v2 API and are stable.
