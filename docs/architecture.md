# Architecture

dsh-redmark is a DSH **Cordis web bundle**: a plain-ESM plugin with two
halves that load into different runtimes. It deliberately has **no npm
dependencies**; React/React-DOM are supplied by the host.

```
┌─────────────────────────── DSH desktop (Node) ───────────────────────────┐
│  index.js  (export const inject = ['webServer']; export function apply)   │
│    └─ webServer.register({ kind:'prefix', path:'/dsh-redmark' })    │
│         GET / HEAD / POST  →  dsh-redmark.json  (+ .trace.log)      │
└──────────────────────────────────┬───────────────────────────────────────┘
                                   │  same-origin JSON (best-effort)
┌──────────────────────────────────┴───────────────────────────────────────┐
│  client.js  (window.__ModuleLoader__.load({ id, factory }))               │
│    storage → slots → jump-back engine → diagnostics                        │
└───────────────────────────────────────────────────────────────────────────┘
```

## Host half — `index.js`

Injects `webServer` and registers a prefix route at `/dsh-redmark`.
The endpoint is **strictly best-effort**: the Web half remains fully functional
from `localStorage` when it is absent (apply() logs
`dsh-redmark: webServer unavailable, durability mirror disabled`).

- Storage file: `<DSH_HOME>/dsh-redmark.json` (default `~/.dsh/`), capped
  at `MAX_DB_BYTES = 16 MiB`.
- `load()` parses the JSON; on corruption the file is renamed `*.corrupt`
  rather than silently reset.
- `persist()` writes atomically via a temp file plus `rename`, serialized
  through a write chain.
- Records are sanitized server-side; `MAX_LIST = 500`, `MAX_NOTE = 2000`.
- Erasing all bookmarks keeps a `.erased-<timestamp>` backup.
- A failed write returns `507`, which the Web half treats as "not durable" and
  keeps the in-memory/localStorage copy authoritative.
- Same-origin checks (`sec-fetch-site` / `origin`) guard the route.

## Web half — `client.js`

Loaded through `window.__ModuleLoader__.load({ id: '@local/dsh-redmark',
factory(require) {...} })`. The exported module is
`{ name: '@local/dsh-redmark', inject, apply }` with:

```
inject = ['slots','locale','layout','uiWorkspace','sidebarRightTabs','sidebarRight']
```

### Storage and mirroring

- Primary store is `localStorage` under `dsh.dsh-redmark.<sessionId>`,
  with an in-memory `Map` cache, a `subscribe`/`notify` listener set, and a
  `sanitize(list)` pass that drops malformed records, deduplicates ids, and caps
  the list at `MAX_LIST = 500`.
- **Legacy-data compatibility**: on first read, bookmarks stored under an older
  localStorage key are adopted and copied forward to `dsh.dsh-redmark.<sessionId>`
  (the old copy is left intact). The all-sessions page scans both prefixes, and
  the Host loads an older mirror file when `dsh-redmark.json` is absent, so no
  existing bookmarks are lost.
- `writeStore(sessionId, list, explicit)` mirrors to the Host endpoint; an empty
  list is only mirrored when `explicit === true`. Failed mirrors are retried by
  `flushMirror` on a 15 s interval.
- Bookmark kinds: `text` and `turn`. A record carries `{id, turn, seq, note,
  createdAt, kind, nodeKey, quote(≤600), start, end, prefix(≤40), suffix(≤40),
  sessionTitle(≤120)}`.

### Slots

Each registration in `apply(ctx)` is wrapped in `try/catch` so one missing slot
never disables the rest:

| Slot | Purpose |
| --- | --- |
| `conversation.chat.assistant-actions` (id `dsh-redmark-add`, order 40) | Add-bookmark trigger in the message toolbar |
| `sidebar.panellist` (id `dsh-redmark`, order 30) | Dedicated bookmarks panel |
| `main` (key `dsh-redmark`) | Panel content |
| `sidebarRightTabs` + `sidebar.right.pane.tab` | Right-side tab and pane |
| `conversation.session.header.utilities` (orders 40/41) | Open-panel and find buttons |
| `conversation.composer.dock` | Find-in-conversation bar |
| text-selection tools | "Bookmark selection" action |

The find bar intercepts `Ctrl/Cmd+F` in the capture phase but never steals keys
from editable fields.

### Jump-back engine (the heavily optimized part)

This area was tuned across many rounds against a diagnostic trace. The guiding
principle: **call DSH's own functions; never write scroll positions or fake
scroll events.**

- **Plan C anchor integration** (`anchorStore`, `readAnchor`, `restoreAnchor`):
  reach DSH's `chatScroll {save, read}` store and the `scroll` handle's
  `returnToBottom()` through React fibers (`__reactFiber$`). `save(null)` means
  "reopen at tail"; `save(position)` pins. DOM fallback for the scroll handle is
  `button[class*="toBottom"]`.
- **Rail-driven jump** (`railHandle`, `jumpViaRail`): find the `TurnNavigator`
  fiber (props `{items, onNavigate, activeTurn}`) up to 30 levels up and call
  `onNavigate(item)` directly. Clicking/scrolling the rail as a second writer
  caused flicker, so it is avoided. `railTurnOf` parses the **trailing** number
  of the item's `aria-label` — localized labels may contain another digit, and
  rejecting the whole label broke every cross-turn jump. `jumpViaRail` increments
  `jumpInFlight` for the whole request so a concurrent re-pin cannot cancel
  ChatView's pending navigation; it waits up to 60 s for the landed row and
  returns a reason (`not-in-items`, `threw`, `no-handle`, `aborted`, `no-landing`).
- **`jumpToTurn`**: fast path via `settleOn` when the row is already mounted;
  otherwise `jumpViaRail`, with a legacy pager fallback **only** when the rail
  reports `no-handle`. Phase 1 pages older history (up to 240 iterations, 20 s
  no-progress wall clock) by nudging `scrollTop` 1→0 to trigger history
  consumption and clicking "load older"; Phase 2 bisects the scrollport with
  `JUMP_PROBES = 48` plus a near sweep.
- **Text-range bookmarks** use the CSS Custom Highlight API
  (`makeHighlight`/`CSS.highlights`) and are repainted on a slow poll plus
  scroll, because the transcript virtualizes its rows.

### Follow-tail guard (`startFollowGuard`)

Symptom: while a reply streams, the transcript silently stops following the
tail and slides back to the user's own message.

Measured root cause: the pin is dropped with **no reader gesture**
(`intentAge=none`) while `scrollHeight` grows; DSH interprets any `scrollTop`
movement as reader intent and drops `followingTail` during reflow. The repair
is intentionally narrow — all of these must hold:

1. the pin was on and then gone;
2. no intent stamped within 700 ms (quiet) — reader-initiated scrolls are
   respected, never repaired;
3. near tail, `gap < 600` px;
4. cooldown elapsed (> 1.2 s, repair re-arms after 220 ms);
5. no jump in flight (`jumpInFlight` false).

Deliberate non-goals, learned from the trace:

- **No gap-based repair** — a pinned-but-idle view shows a ~240 px gap because
  of the input fold; "fixing" the gap would fight normal layout.
- **Streaming is not required** — the drop arrives ~0.62 s after arming when
  per-turn triggers mount, so gating on streaming missed the case.
- A repair cap of **200** restores; beyond that the guard stays pass-through
  until reload, avoiding runaway re-pin loops.
- Guard state is session-scoped (`guardSession`/`resetState`) to avoid
  cross-session carryover, and intent is stamped only for gestures inside the
  transcript scroller.

The add-bookmark trigger was also moved into the toolbar's pre-reserved 28 px
row as a flex item: mounting a slot box in the flow added 32–96 px per mount,
crossing DSH's 24 px follow tolerance and silently unpinning the view.

### Diagnostics

`trace()`/`traceForce()` POST same-origin JSON `{lines}` to
`/dsh-redmark/trace`; every failure is swallowed so diagnostics can never
break the feature. The Host appends to `<DSH_HOME>/dsh-redmark-trace.log`,
capped at 200 lines × 400 chars per flush and rotated at `TRACE_MAX_BYTES = 1 MiB`.

Trace families: `guard: armed`, `guard: arm growth=...`, `guard drop: gap=...
intentless=... nearTail=... streaming=... cooldown=... jumping=... grew=...
bm=... rows=... top=... sh=...`, `guard: re-pin after intentless drop`,
`query=...`, `scan ranges=...`, `reveal ... align ok=true`, `step delta=...`,
and `paint: ...`. See [usage.md](usage.md) for how to read them.
