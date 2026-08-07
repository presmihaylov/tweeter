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

`?` opens a popup that lists every key below, in three groups: moving around, acting on a tweet, and writing in the drawer. The header carries a `? keys` hint instead of the row of shortcuts it used to, because each new key pushed that row's right edge off a narrow window. The popup floats over the panes rather than replacing them, so the feed keeps its place; `?`, `Esc`, `Enter`, `q` or a click closes it, and it swallows every other key while it is up.

The card lays itself out for the window it opens in. It sits in the middle of the terminal and takes most of it, then centres the keys inside itself, so the popup reads as a window over the app rather than as a stray line of output. Its three columns collapse into two, then one, on a terminal too narrow to hold them side by side, rather than wrapping a description away from the key it belongs to; the groups are shared out to keep the stacks the same height. One stack of every key runs about forty rows, more than a short window has, so the card takes the full height there and what still does not fit scrolls with `↑` / `↓`, `j` / `k` or `PgUp` / `PgDn`. The bottom border says so only when there is something to scroll to.

- `?` — open or close the key popup
- `j` / `k` — move the feed selection, whatever the arrows are pointed at
- `Tab` — switch between Following and For You
- `s` — sort Following by Popular or Recent
- `R` — refresh the feed; new tweets come in at the top
- `→` — point the arrows at the open tweet's text when it does not fit the pane, then at the replies, on the first one
- `←` — point the arrows back at the feed, or leave the open tweet when the feed already has them
- `↓` / `↑` — move the selection in whichever list the arrows point at, or scroll the text when they point at it
- `Shift+↓` / `Shift+↑` — move through the replies without leaving the feed selection, and up onto the card the tweet replies to
- `Shift+→` — open the selected reply or replied-to card, or the quoted tweet when nothing is selected (a click on the card does the same)
- `Shift+←` — go back to the tweet you came from
- `Ctrl+S` / `Ctrl+W` — scroll the open tweet's text down / up when it is longer than the pane
- `Enter` — load the next page of replies for the open tweet
- `p` — enlarge the open tweet's first photo, or the article picture on the screen (a click enlarges the picture you clicked; `p`, `Esc`, `Enter` or a click closes it)
- `v` — hand the open tweet's video to your system player
- `o` — open the open tweet in your browser
- `l` — like the open tweet, or take the like back
- `b` — bookmark the open tweet, or take the bookmark off
- `r` — reply to the open tweet; type, then `Enter` sends and `Esc` closes
- `t` — repost the open tweet with your own words; the same drawer opens and posts a quote
- `q` — quit

The drawer is a text field. `←` / `→` move the caret, `Alt+←` / `Alt+→` jump a word, `Home` / `End` (or `Ctrl+A` / `Ctrl+E`) reach the two ends, and `Backspace` / `Delete` take the character on either side of it. A paste lands whole.

A tweet with several photos draws them side by side, up to the four X allows. Click one to enlarge it.

Every card carries how long ago the tweet went out, on the right of the author line: `now`, `45s`, `5m`, `3h`, `2d`, and then the calendar day (`Jul 30`, or `Mar 9, 2024` for another year). The open tweet says the same next to its handle, and its counts line ends with the exact clock and date in your own timezone.

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

X answers a tweet detail with more than the conversation. It pads a thin thread with unrelated tweets under a "Discover more" header and injects ads between the replies. Only `tweet-` and `conversationthread-` entries are replies, so the extraction keeps those and drops the rest.

The home feed gets the same treatment. X sends a reply from somebody you follow as a `home-conversation-` module holding the tweet that was answered and then the answer, which x.com draws as one connected column. As separate cards they read as the same conversation twice, so the feed keeps the tweet the thread starts from and leaves the replies to the detail pane. `promoted-tweet-` entries are ads and never reach the feed. On a live page that turns 109 cards into 78.

The "Sort by" menu x.com shows on its Following tab is a single GraphQL variable, `enableRanking` on `HomeLatestTimeline`: `true` is Popular, `false` is Recent, and a request that omits it behaves as Recent. `s` toggles it. The two sorts really are different feeds — one live pair came back as 31 tweets against 69, sharing four of them — so the keystroke drops the loaded page and its cursor and starts again at page one, rather than paging on with a cursor that indexes the old order. For You is a different operation with no such menu and never carries the variable.

A page of the home feed carries two cursors and they point opposite ways. The top one asks for what arrived since that page was drawn, and it comes back empty when nothing has; the bottom one asks for the next page down. `R` sends the top cursor and puts what it gets above the page you already have, which is where new tweets belong, and then puts the selection on the newest of them. The older pages need no key: the feed sends the bottom cursor on its own once the selection comes within five cards of the end, so `j` keeps running. Each cursor moves only on the fetch that matches its direction, because a page pulled from the bottom names its own top rather than the newest tweet, and taking that top would make the next `R` skip backwards over everything in between.

The feed keeps the order X sends and never re-sorts it. That order is not the tweet timestamps: a repost carries the original tweet's time, a `home-conversation-` module is placed by the reply that surfaced it while the card shows the thread root, and the ranked sort orders by relevance outright. On one live Recent page, 14 of 78 cards ran backwards in time by that measure, the largest step being about 26 hours. Sorting by the timestamps we hold would move those cards away from where x.com puts them, so the fetch direction is the only thing that decides where a tweet lands.

The replies render as the same bordered cards as the timeline, each with the reply author's circular avatar, name, handle, text and its own reply, repost and like counts. `→` points the arrow keys at the reply list and lands on the first card, `↓` and `↑` then walk it, and `←` points them back at the feed. `Shift+↓` and `Shift+↑` do the same walk from the feed, without giving up the arrows. The list scrolls when the selection passes the last visible card. `Shift+→` opens the selected reply in the detail pane, so its own replies, photo and `o` shortcut then act on it. A click on a reply card opens it directly.

When the open tweet answers another tweet, the detail pane draws that tweet as a `↩ Replying to` card above the author row, the way x.com shows the post a reply belongs to. The card is a selection target of its own: `Shift+↑` picks it from the top of the reply list, `Shift+→` opens it, and a click does the same. The card only appears once the answered tweet is already loaded, which is always true after you drill into a reply. X answers a tweet detail with the whole thread, so the tweets above the open one arrive with its replies; they feed the parent card and stay out of the reply list.

A quoted tweet renders as its own bordered card in the detail pane, with the quoted author's avatar and photo, the way x.com nests it inside the post. Click that card, or press `Shift+→` with no reply selected, to open the quoted tweet. Press `Shift+←` to go back. A quote or a reply inside another nests as deep as the data allows, and `j`/`k` leaves the chain.

A repost shows the tweet somebody reposted, not the repost itself. X serves a repost as a wrapper whose own text stops at 140 characters and which carries no media and no replies, so the TUI unwraps it and renders the original. The card and the detail pane name the person who reposted it: `↻ Some One · ` in front of the author on the card, and `@handle  ·  ↻ Some One reposted` under the name in the detail pane.

An article is a long post published on x.com rather than a tweet, and the home feed sends it as its title alone: one live card carried 40 characters where the article ran to 3954. Only the tweet detail carries the body, so the reply fetch that fires when you rest on a card now also hands back the tweet you are resting on, and that fuller copy replaces the feed copy in place. Both the card and the detail pane mark it with `▤ article · ` in front of the author, because a title with no body otherwise reads as an ordinary short tweet. The badge goes in front rather than at the end, since a card line is narrow and loses its end to truncation first.

An article also claims every row the detail pane can spare above one reply card, instead of the 12 a long tweet gets, and it earns a stop of its own on the way right: `→` gives the arrows to the text, `↑` and `↓` then scroll it a line at a time, and the cut edges name those keys instead of `Ctrl+W` and `Ctrl+S`. The next `→` moves on to the replies and `←` returns to the feed. `Ctrl+S` and `Ctrl+W` still page the text from anywhere, and `j`/`k` still leave for the feed. Only a text that overflows the pane becomes a stop, so a short tweet keeps the old walk where `→` lands straight on the replies.

An article body arrives as a Draft.js document, not as a run of text, and the images live in it: an atomic block names an entity, the entity names a media id, and the media list resolves the original file. X does send a flat `plain_text` copy of the same article, but it is a stale snapshot that carries no images at all, and one live article had 32 blocks against 28 lines there, so the blocks are what reaches the screen. The pane draws the pictures where the author put them, cover image first, with the caption underneath as its own line and the headings and bullets kept. The body is therefore a column of text rows and picture boxes that scrolls as one, and a picture costs the rows it draws on: the `▾ 47 more below · ↓` marker counts those rows too.

A picture takes at most half the body, and never more than 10 rows, because the window only draws a picture that fits in the rows it has left. A taller one would sit out every scroll position but its own and leave a blank foot in its place. Click a picture, or press `p`, to open it full screen; `p` picks the topmost picture on the screen, so scroll to the one you want first. The caption row under the body counts them and names the key: `3 images in the article  ·  click one, or p enlarges the one on screen`.

A video renders as its poster frame, because a terminal cannot play the mp4. The caption under it states the size, the length and the key: `video 1920×1080 · 22:02 · v plays it`. Press `v` to hand the highest-bitrate mp4 to your system player.

## Replying and liking

Press `r` on the open tweet. The composer opens across the bottom, names the handle you are answering, and counts the draft against the 280-character limit as you type. `Enter` sends it, `Esc` throws it away. A draft over the limit is refused locally, so the text stays in the box instead of dying on a round trip.

The drawer wraps and grows a row at a time as the draft passes the width, up to eight rows, which holds a full 280 characters down to a 40-column window. Past that the head of the draft scrolls out of sight rather than the foot, because the foot is where you are typing. A refusal from X is printed under the draft in the same drawer.

The status line then carries the new tweet's id. A refusal is reported verbatim from X, with the error code and the path of the debug log.

X sometimes refuses a write with error 344 and the message "You have reached your daily limit for sending Tweets and messages". The message is not true. One live burst refused the same reply five times and passed on the sixth, eight seconds later, on an account that had posted four replies that day against a cap in the thousands. 344 is a per-request guard, in the same family as 226, and X names a quota instead of the real reason. So a write refused with 344 is sent again on its own, after 1s, then 2.5s, then 6s: four attempts in all. A refused `CreateTweet` posts nothing, so no retry can double post. The status line says what the TUI is doing (`X refused the reply (code 344); retry 2 of 3 in 2.5s`) rather than repeat a reason that would send you to check a quota that is fine. Every refusal and every retry goes to the debug log.

Error 226 is the other refusal, and it is a different animal. It means the automation gate shut, not that one request looked wrong. One live block wrote 24 refusals into the debug log over five minutes: three bursts of hand retries, roughly one attempt a second, every one of them signed with a fresh transaction id and every one of them refused. Fast retries only hold the gate shut. So 226 gets its own ladder, which starts above that whole burst and doubles from there: 5s, 15s, 30s, 60s, 120s, six attempts across 230 seconds. Each code counts its own attempts, because a run can start on 344 and end on 226. When the last delay is spent the composer keeps the draft, and the screen says the gate opens again after a few quiet minutes rather than inviting another press of `Enter`.

`l` likes the open tweet and `l` again takes the like back. It is one GraphQL mutation each way, `FavoriteTweet` and `UnfavoriteTweet`, both answering with the string `"Done"`. The card moves first and the request follows, so the heart fills the moment you press the key; a refusal puts the count and the heart back where they were and reports the reason. X answers a second like on the same tweet with error 139, which only means the like is already there, so that counts as success. One tweet takes one call at a time, or a fast double press would race itself.

`b` bookmarks the open tweet and `b` again takes the bookmark off, through `CreateBookmark` and `DeleteBookmark`. It behaves like the like in every way that matters: optimistic, rolled back on refusal, one call per tweet at a time, and X's repeat codes counted as success in both directions (139 for a bookmark already there, 144 for one already gone). A bookmark is private, so the card only shows a `⚑` when you hold one and the counts line in the detail pane carries the number. `CreateBookmark` is stricter than the like endpoints in one way: it verifies `x-client-transaction-id` and answers a bad one with a bare 404, so a stale generator looks exactly like a dead query ID. The next section says how to tell them apart.

X's automation check is the one thing that can break this without warning. A run of `error 226` that the ladder cannot outwait means one of two things. Either the gate is shut on the account for a while, which quiet time clears, or X tightened the heuristic and the headers no longer pass. The debug log tells them apart: `twitter.createTweet.refused` records `transactionIdSent`, so a false value points at the fingerprint. The fix for that is in `HeaderBuilder.baseHeaders` in `src/twitter/headers.ts`, which is the single place the browser fingerprint headers are set.

One header is built per request rather than in `HeaderBuilder`: `x-client-transaction-id`. `src/twitter/transactionId.ts` derives it the way the x.com bundle does, because its value covers the request path and method. The bundle reads a 48-byte key from the `twitter-site-verification` meta tag of the signed-in shell, plays one of four hidden SVG loading animations at a frame the key picks, reads the resulting CSS `color` and `transform` back, and hashes that together with the path, the method and a timestamp counted from 2023-05-01. The result is 70 bytes, XOR-masked with a random first byte and base64-encoded. `PageContextStore` fetches the shell once per session and holds it, the way a browser tab holds one page load.

Two details of that animation are Chrome behaviour, not CSS behaviour, and both change the answer: Blink prints matrix components with C's `%.6g`, so `3.41315e-05` where JavaScript prints `0.0000341315`, and its cubic-bezier solver is an 11-entry sample table, not an exact solve. `tests/transactionId.test.ts` replays 120 ids captured from the real in-page generator; they all have to match byte for byte.

Which bytes of the key pick the animation, the frame and the pause is the part X moves. It shipped a new `ondemand.s.*.js` that moved the frame byte from 7 to 12 and the pause bytes from 30/47/2 to 1/28/29, and from then on every request signed by the old indices carried a wrong header. Reads and likes did not care, because they do not check it, so the only symptom was `CreateBookmark` returning 404. The three index groups sit at the top of `computeAnimationKey` in `src/twitter/transactionId.ts` and the fixture test pins them. To find them again after a rotation: hook `crypto.subtle.digest` in a real x.com tab to read the preimage the page hashes, capture a handful of samples, and search the 4 x 16 x 16³ index space for the triple that reproduces all of them. The capture needs no account, because the verification key and the four loading animations are on the logged-out shell too, which is where the fixture comes from.

The generator fails open. A shell that cannot be parsed means the header is omitted and the request still goes out, because reads worked without it before this existed. Every miss lands in the debug log as `twitter.transactionId.noPageContext` or `twitter.transactionId.failed`. A refused write drops the cached page data, since a rotated key is one of the few things that can make an otherwise good request look wrong.

Measured against the live API, error 226 does not track this header: a fabricated value, a captured value and no value at all all got past it. Treat the header as one input to a heuristic that also weighs the TLS fingerprint, the header order and the account history. Because the check is a heuristic, repeated refused writes make X stricter for a while. When you are testing this path, pace the attempts and expect a cooldown after a burst.

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
- articles rendered from their Draft.js body: the inline images in the author's own order, headings, bullets, a `▤ article` badge, and a click or `p` to enlarge a picture
- drill into a quoted tweet by click or `Shift+→`, and back out with `Shift+←`
- replies fetched automatically for the tweet under the cursor, one request per tweet, `Enter` for the next page
- reply cards with avatars and counts in the detail pane, `→`/`←` to move the arrow keys between the feed and the list, `Shift+→` to open one
- `↩ Replying to` card above an open reply, selectable with `Shift+↑` and openable by `Shift+→` or a click
- x.com-style detail pane: author avatar block, full wrapped text with `Ctrl+S`/`Ctrl+W` scrolling, bottom metrics bar
- chafa media preview helper + external open/copy helpers
- normalized state reducer/store helpers
- `l` to like or unlike the open tweet, drawn as a filled `♥` on the count, applied optimistically and rolled back on refusal
- `b` to bookmark or unbookmark the open tweet, drawn as a `⚑` on the card, applied the same way
- `?` floats a centred key popup over the panes, in three columns that collapse to two and then one on a narrow terminal, and scroll when the window is too short
- `R` refreshes from the top cursor and prepends what is new, while the older pages page in from the bottom cursor on their own as the selection nears the end
- automatic retry with backoff on X's transient write refusal (error 344) and on its automation gate (error 226, up to 5 retries over 230s), for replies, likes and bookmarks
- mocked tests for config import, auth headers, extraction, timelines, refresh direction, replies, likes, bookmarks, the key popup and its reflow, the cookie write path and its refusal codes, OAuth flow, media helpers

Live X GraphQL endpoints can still break when operation IDs or response shapes change; query ID refresh and tests are set up to make those failures visible. Replies additionally depend on X's automation heuristic, which X can tighten at any time.

The official X v2 API client and its OAuth 2.0 PKCE flow are still in the tree, behind `tweeter auth twitter --client-id <id>`. Nothing in the TUI uses them now that cookies post replies. They stay as a paid fallback if X ever closes the cookie write path.

## License

MIT. See [LICENSE](LICENSE).
