# tweeter

Local Twitter/X TUI launched with `tweeter`, built with Bun, TypeScript, and OpenTUI.

## How it works

Everything, reads and replies alike, goes through X's private GraphQL endpoints with two cookies from your signed-in browser tab. Same approach as the [`birdgo`](https://github.com/presmihaylov/birdgo) CLI. No developer app, no API quota, no per-post billing.

Replies post through the `CreateTweet` mutation, which is the exact call x.com makes when you reply in the browser. X guards that mutation with an automation check: a request that omits the browser fingerprint headers comes back with error 226, "this request looks like it might be automated", and posts nothing. tweeter sends those headers, so the write lands. Reads never needed them.

There is no rate limit to buy and nothing to configure past the two cookies.

## Install

```bash
bun install
bun run check
bun run install:local
```

`install:local` compiles a standalone binary and copies it to `~/.local/bin/tweeter`. Re-run it after any code change.

## Quick start

```bash
tweeter
```

On first run, tweeter imports `~/.config/birdtui/config.json` (the pre-rename location), then `~/.config/birdgo/config.json`, whichever exists first. Otherwise it opens an onboarding screen that walks you through the two cookies.

### Getting the two cookies

1. Open <https://x.com> in your browser and sign in.
2. Open DevTools (`F12`, or `Cmd+Opt+I` on macOS) and pick the **Application** tab. Firefox calls it **Storage**.
3. Expand **Cookies** in the sidebar and click `https://x.com`.
4. Copy the **Value** of `auth_token`, then of `ct0`.
5. Paste each into the onboarding screen and press Enter.

That is the whole setup. Reads and replies both work from there.

You can also skip the screen:

```bash
tweeter --set-cookie-header 'auth_token=...; ct0=...; <the rest of the header>'
tweeter --check-auth
```

Pasting the full `Cookie` request header is the most reliable route, because X sometimes ties a session to companion cookies. Copy it from DevTools → Network → any `x.com` request → Request Headers → `cookie`.

**Treat both cookies as passwords.** Anyone holding them is signed in as you. They are stored in plain text in `~/.config/tweeter/config.json` and are never sent anywhere but x.com. `tweeter --reset-auth` clears them. Signing out of x.com in the browser invalidates `auth_token`, so tweeter then needs a fresh pair.

## Keys

- `j` / `k` — move the feed selection, whatever the arrows are pointed at
- `Tab` — switch between Following and For You
- `R` — refresh the feed
- `→` — point the arrows at the replies, on the first one
- `←` — point the arrows back at the feed, or leave the open tweet when the feed already has them
- `↓` / `↑` — move the selection in whichever list the arrows point at
- `Shift+↓` / `Shift+↑` — move through the replies without leaving the feed selection, and up onto the card the tweet replies to
- `Shift+→` — open the selected reply or replied-to card, or the quoted tweet when nothing is selected (a click on the card does the same)
- `Shift+←` — go back to the tweet you came from
- `Ctrl+S` / `Ctrl+W` — scroll the open tweet's text down / up when it is longer than the pane
- `Enter` — load the next page of replies for the open tweet
- `p` — enlarge the open tweet's photo (click a photo does the same; `p`, `Esc`, `Enter` or a click closes it)
- `v` — hand the open tweet's video to your system player
- `o` — open the open tweet in your browser
- `r` — reply to the open tweet; type, then `Enter` sends and `Esc` closes
- `q` — quit

## Scripts

- `bun run dev` — run the TUI from source
- `bun run build` — build `dist/cli.js` (needs bun at runtime)
- `bun run build:bin` — compile the standalone `dist/tweeter` binary
- `bun run install:local` — build the binary and install it to `~/.local/bin/tweeter`
- `bun run test` — unit/integration tests with mocked network
- `bun run typecheck` — TypeScript strict mode
- `bun run lint` — ESLint strict rules, including no explicit `any`
- `bun run check` — typecheck + lint + tests

## Images

Author avatars and the selected tweet's photo render inline with the [kitty graphics protocol](https://sw.kovidgoyal.net/kitty/graphics-protocol/). This needs:

- a terminal that speaks the protocol — Ghostty, kitty, or WezTerm (auto-detected from `TERM`/`TERM_PROGRAM`; force it with `--renderer kitty`)
- `magick` (ImageMagick 7) on `PATH` — it converts to PNG, resizes to the exact cell rectangle, and masks avatars into a circle

The detail pane opens a tweet the way x.com does: a circular author avatar with the name and handle at the top, the full text below it with the author's own line breaks and HTML entities decoded, then the photo, the quoted card, the replies, and a metrics bar anchored to the bottom row with the comment, repost, like and view counts. A tweet longer than the pane marks its cut edges inside the text itself: `▴ 10 more above · Ctrl+W` on top and `▾ 26 more below · Ctrl+S` at the bottom. `Ctrl+S` scrolls down and `Ctrl+W` scrolls up.

The replies load on their own. Rest on a tweet for a moment and its first page of replies arrives without a keystroke, so `j` and `k` can run down the feed without firing a request for every tweet they pass. Each tweet is asked once. `Enter` fetches the next page, and it is also how you retry a page that failed.

The replies render as the same bordered cards as the timeline, each with the reply author's circular avatar, name, handle, text and its own reply, repost and like counts. `→` points the arrow keys at the reply list and lands on the first card, `↓` and `↑` then walk it, and `←` points them back at the feed. `Shift+↓` and `Shift+↑` do the same walk from the feed, without giving up the arrows. The list scrolls when the selection passes the last visible card. `Shift+→` opens the selected reply in the detail pane, so its own replies, photo and `o` shortcut then act on it. A click on a reply card opens it directly.

When the open tweet answers another tweet, the detail pane draws that tweet as a `↩ Replying to` card above the author row, the way x.com shows the post a reply belongs to. The card is a selection target of its own: `Shift+↑` picks it from the top of the reply list, `Shift+→` opens it, and a click does the same. The card only appears once the answered tweet is already loaded, which is always true after you drill into a reply. X answers a tweet detail with the whole thread, so the tweets above the open one arrive with its replies; they feed the parent card and stay out of the reply list.

A quoted tweet renders as its own bordered card in the detail pane, with the quoted author's avatar and photo, the way x.com nests it inside the post. Click that card, or press `Shift+→` with no reply selected, to open the quoted tweet. Press `Shift+←` to go back. A quote or a reply inside another nests as deep as the data allows, and `j`/`k` leaves the chain.

A repost shows the tweet somebody reposted, not the repost itself. X serves a repost as a wrapper whose own text stops at 140 characters and which carries no media and no replies, so the TUI unwraps it and renders the original. The card and the detail pane name the person who reposted it: `↻ Some One · ` in front of the author on the card, and `@handle  ·  ↻ Some One reposted` under the name in the detail pane.

A video renders as its poster frame, because a terminal cannot play the mp4. The caption under it states the size, the length and the key: `video 1920×1080 · 22:02 · v plays it`. Press `v` to hand the highest-bitrate mp4 to your system player.

## Replying

Press `r` on the open tweet. The composer opens across the bottom, names the handle you are answering, and counts the draft against the 280-character limit as you type. `Enter` sends it, `Esc` throws it away. A draft over the limit is refused locally, so the text stays in the box instead of dying on a round trip.

The status line then carries the new tweet's id. A refusal is reported verbatim from X, with the error code and the path of the debug log.

X's automation check is the one thing that can break this without warning. If replies start coming back with `error 226`, X has tightened the heuristic; the fix is in `HeaderBuilder.baseHeaders` in `src/twitter/headers.ts`, which is the single place the browser fingerprint headers are set.

Click a photo, or press `p`, to open it in a full-screen lightbox. The lightbox replaces the feed and detail panes, so the photo gets the whole window instead of the few rows the detail pane can spare. Click it again, or press `p`, `Esc` or `Enter`, to close it.

Prepared images are cached under `~/.cache/tweeter/media`. Without a kitty-capable terminal or without `magick`, the TUI degrades to text and captions.

Multiplexers often swallow the terminal's pixel-size query. tweeter then assumes a cell aspect of 1:2.2, which distorts images by a few percent. Pin the real size to remove that:

```bash
export TWEETER_CELL_PX=19x44
```

## Useful env vars

- `TWEETER_CONFIG_DIR` — override config dir for tests/dev (default `~/.config/tweeter`)
- `TWEETER_CACHE_DIR` — override cache dir for tests/dev (default `~/.cache/tweeter`)
- `TWEETER_IMAGE_RENDERER=auto|chafa|kitty|none`
- `TWEETER_CELL_PX=WxH` — pin the terminal cell size in pixels when auto-detection fails

## CLI flags

```
tweeter [--profile name] [--renderer auto|chafa|kitty|none] [--debug-log path]
tweeter --check-auth [--profile name]
tweeter --set-cookie-header 'name=value; ...' [--profile name]
tweeter --reset-auth
tweeter auth twitter --client-id <id> [--profile name] [--port N] [--no-browser]
```

## MVP status

Implemented:

- Bun/TypeScript project + `tweeter` executable
- OpenTUI terminal shell with feed/detail/replies/composer state
- first-run onboarding/instructions
- import from the pre-rename birdtui config and from birdgo config
- local config/cache stores with zod validation
- X cookie auth check, home timeline, tweet detail/replies via GraphQL
- **replies through the `CreateTweet` GraphQL mutation on the same cookies, with the browser fingerprint headers that clear X's automation check**
- query ID cache, fallbacks, and rediscovery from the signed-in x.com shell, for reads and writes alike
- tweet/media/cursor extraction from GraphQL timeline instructions
- reposts unwrapped to the original tweet, so its full text, media and replies show, with a `↻` label for the reposter
- video poster frame in the detail pane, with the length in the caption and `v` to play the mp4 outside
- inline kitty-graphics rendering: circular author avatars on every tweet card, full photo in the detail pane
- nested quoted-tweet card in the detail pane, with the quoted author's avatar and photo
- click-to-enlarge photo lightbox that takes over the window
- drill into a quoted tweet by click or `Shift+→`, and back out with `Shift+←`
- replies fetched automatically for the tweet under the cursor, one request per tweet, `Enter` for the next page
- reply cards with avatars and counts in the detail pane, `→`/`←` to move the arrow keys between the feed and the list, `Shift+→` to open one
- `↩ Replying to` card above an open reply, selectable with `Shift+↑` and openable by `Shift+→` or a click
- x.com-style detail pane: author avatar block, full wrapped text with `Ctrl+S`/`Ctrl+W` scrolling, bottom metrics bar
- chafa media preview helper + external open/copy helpers
- normalized state reducer/store helpers
- mocked tests for config import, auth headers, extraction, timelines, replies, the cookie write path and its refusal codes, OAuth flow, media helpers

Live X GraphQL endpoints can still break when operation IDs or response shapes change; query ID refresh and tests are set up to make those failures visible. Replies additionally depend on X's automation heuristic, which X can tighten at any time.

The official X v2 API client and its OAuth 2.0 PKCE flow are still in the tree, behind `tweeter auth twitter --client-id <id>`. Nothing in the TUI uses them now that cookies post replies. They stay as a paid fallback if X ever closes the cookie write path.
