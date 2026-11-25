# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [4.0.8] - 2026-11-25

### Fixed
- Every jump failed with `[no-scroller]` because the session-scope lookup never
  worked. `sessionRoot()` concatenated the attribute name and its value
  OUTSIDE the brackets — `[data-conversation-session]` + `="<id>"` — building an
  invalid selector; `querySelector` threw, the surrounding `catch` swallowed the
  error, and the function returned `null` for every session, including the one
  already on screen. Since 4.0.5 made that `null` authoritative instead of
  falling back to `document`, the failure became total: the jump refused to run
  against any conversation. The selector is now built as
  `[data-conversation-session="<id>"]`.
- The `sessions` service is declared in the client `inject` list. Without it the
  session snapshot (and therefore `openState`) was never readable, which is why
  the 4.0.7 wait logged `openState=unavailable`.

## [4.0.7] - 2026-11-25

### Fixed
- Jumping into a very large session no longer errors with a bare `[no-scroller]`
  while the transcript is still loading. The shell keeps the Chat flow unmounted
  until the session reaches `openState === 'open'` (it shows a settling
  placeholder the whole time it is `loading`), so the jump's mount waits now
  read the session snapshot's `openState` and wait up to 30s for `open`, rather
  than only polling for the `[data-chat-flow]` node. When the session is still
  `loading` at the deadline, the toast explains it is still loading instead of
  reporting a generic failure.

## [4.0.6] - 2026-11-25

### Fixed
- Jumping into a very large session no longer fails with `[no-scroller]`. The
  Chat-flow wait was a 180-frame (≈3s) budget, which a 7.8M-token session blew
  past while mounting, so the jump gave up before the conversation existed in
  the DOM. The mount waits (`jumpToTurn`, `jumpInPlace`) now use a 15-second
  wall-clock deadline, and the quoted-passage wait in `revealQuotedNode` is
  extended to 8s / 240 frames to outlast a hard-virtualised mount.

## [4.0.5] - 2026-11-25

### Fixed
- Cross-session jumps no longer land on the wrong conversation. `sessionRoot`
  used to fall back to `document` when the named session was not mounted yet,
  which made every scoped query (`q`/`qa`/`findScroller`) resolve against the
  FIRST Chat flow in the page — the previously open conversation. It now returns
  `null` so the jump waits for the real session to mount.
- Jumping to a bookmark from the all-bookmarks page now clears the main panel
  back to the Conversation before opening the target session, so the Chat flow is
  actually mounted to switch into (previously `openSession` had nothing visible
  to replace and the jump re-ran against a stale/absent session, needing several
  clicks).
- Text-bookmark centring no longer gets undone on the first click while the reply
  is still streaming. `revealQuotedNode` and the by-text fallback now break the
  tail pin right before centring the passage and snapshot/restore the reading
  anchor, matching the find path, instead of fighting DSH's `followTail()`.

## [4.0.4] - 2026-11-25

### Fixed
- Text bookmarks no longer land on the wrong paragraph when the stored node key
  has drifted. A stored key like `14:assistant-step68:76` keeps its kind+step
  (`assistant-step68`) even after a re-render mints a new suffix, so the text
  fallback (`findQuoteInTurn` / `locateQuoteByText`) now resolves that stable
  segment and tries the same step's node first. A short quote that also appears
  in a turn's reasoning/process node no longer settles there first.

## [4.0.3] - 2026-11-25

### Fixed
- Text bookmarks no longer jump twice. A text (selection) bookmark used to land
  on the whole turn row first and then re-centre on the saved passage, which
  read as "jump to the message, then to the content". For text bookmarks the
  jump now pages/rails to get the turn mounted but skips the turn-row centring,
  and `revealQuotedNode` centres the passage directly (removed the redundant
  "centre the host row" step that ran before centring the quote).

## [4.0.2] - 2026-11-25

### Fixed
- Light theme no longer reads as blank paper. DSH paints `--dsw-alias-bg-base`,
  `bg-layer-1` and `bg-layer-2` with the same white in the light theme, so cards
  separated only by a 4% hairline disappeared against the page. Surfaces now come
  from a `--bm-*` bridge: a sunken `bg-module-platform` canvas behind grouped
  containers, white cards with a `border-l2` hairline and the house
  `--dsw-shadow-lv1` lift, and `bg-module-platform` fields for inputs and selects.
- Hover fills no longer vanish in the light theme. Rules that used
  `--dsw-alias-bg-layer-2` (white there) now use `--bm-hover-bg` / `--bm-item-hover-bg`.
- The note popover keeps its frosted look in both themes: light mixes
  `bg-overlay` at 88% with a white gradient and `blur(10px)`, dark keeps the
  original 50% mix and `blur(4px)`.

### Changed
- The dark theme is untouched by the surface bridge: every `--bm-*` token falls
  back to the previous value, so only the light theme changed appearance
  (verified by pixel diff: dark 0.055% changed, light 10.8% changed).

## [4.0.1] - 2026-11-25

### Fixed
- Long notes are no longer truncated. Sidebar cards and page rows now render the
  whole note (`white-space: pre-wrap`, `overflow-wrap: anywhere`) instead of a
  single line clipped with an ellipsis.
- The note editor grows with its content up to `min(40vh, 240px)` and scrolls
  beyond that, instead of being capped at a fixed 124px with
  `overflow-y: hidden`, which made overflowing text unreachable.
- Grouped list rules on the Bookmarks page are now scoped with a descendant
  selector, so they no longer override the sidebar list flex/scroll rule.

### Changed
- Card action buttons (edit/delete) stay pinned to the card's top-right corner
  when the card grows taller.
- The JS auto-grow fallback uses the same `min(40vh, 240px)` cap as the CSS.

## [4.0.0] - 2026-11-23 — dsh-redmark

First public GitHub release of `dsh-redmark`: a DSH Cordis web bundle for
bookmarking turns in long conversations and jumping back to them precisely.

### Added
- Standard project scaffolding adapted to a DSH Cordis web bundle:
  `.github/workflows/ci.yml`, `scripts/check-bundle.js`, `test/bundle.test.js`,
  `.gitignore`, `.env.example`, `LICENSE`, `CONTRIBUTING.md`, and `docs/`.
- Repository metadata (`repository`, `homepage`, `bugs`, `keywords`, `license`,
  `author`) pointing at https://github.com/namei2001/dsh-redmark.
- Bilingual entry points: English `README.md` and Chinese `README.zh-CN.md`
  covering features, install, template mapping, data/privacy, diagnostics, and
  development commands.

### Changed
- Consolidated runtime identifiers: package id `@local/dsh-redmark`, bundle id
  `dsh-redmark`, web route `/dsh-redmark`, mirror `dsh-redmark.json`, trace log
  `dsh-redmark-trace.log`, and localStorage prefix `dsh.dsh-redmark.`.

## [3.1.6] - 2026-11-23

### Fixed
- Jump-back guard: stand down during in-flight jumps (`jumpInFlight`) so a
  concurrent re-pin could not cancel ChatView's pending navigation.
- Added a repair cap (200 restores) after which the guard stays pass-through
  until reload, avoiding runaway re-pin loops.

## [3.1.5] - 2026-11-23

### Fixed
- `railTurnOf` now reads the trailing number of the rail item's `aria-label`
  instead of rejecting the whole label. Localized labels can contain another
  digit, which previously broke every cross-turn jump.

## [3.1.4] - 2026-11-23

### Fixed
- Follow-tail guard: narrow repair to intentless, near-tail, quiet, cooled-down
  pin drops. Reader-initiated scrolls (intent within 700 ms) are now respected
  and never repaired.
- Guard made session-scoped to prevent cross-session carryover.

## [3.1.3] - 2026-11-23

### Changed
- `AddBookmarkButton` mounted into the toolbar's fixed 28 px reserved row as a
  flex item. A slot box mounted in the flow added 32–96 px per mount, crossing
  DSH's 24 px follow tolerance and silently unpinning the transcript.

## [3.1.2] - 2026-11-23

### Added
- Rail-driven jump path: resolve the `TurnNavigator` React fiber handle and call
  `onNavigate(item)` directly, never clicking/scrolling the rail (two writers
  caused flicker). Legacy pager fallback only when no rail handle exists.

## [3.1.1] - 2026-11-23

### Added
- Plan C anchor integration: reuse DSH's own `chatScroll` save/read anchors and
  `returnToBottom()` via React fiber. No synthetic scroll positions or events.
- Structured diagnostic trace mirrored to `dsh-redmark-trace.log`.

## [3.0.0] - 2026-11-23

### Added
- Initial V5 workbench release: dedicated bookmarks panel, right-side tab,
  header utilities, find bar (Ctrl/Cmd+F), and text-range bookmarks via the CSS
  Custom Highlight API.
