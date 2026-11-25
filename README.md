# dsh-redmark

> Bookmark key turns in a long conversation with custom notes, and jump back to
> them from a dedicated panel.
>
> A **Cordis web bundle** for [the agent runtime (DSH)](https://github.com/deepseek-ai/deepseek-harness) —
> not a standalone Python or web service.

[English](README.md) · [中文](README.zh-CN.md)

[![CI](https://github.com/namei2001/dsh-redmark/actions/workflows/ci.yml/badge.svg)](https://github.com/namei2001/dsh-redmark/actions)
![Version](https://img.shields.io/badge/version-4.0.9-blue)
![Node](https://img.shields.io/badge/node-%3E%3D18-green)
![License](https://img.shields.io/badge/license-MIT-green)
![Platform](https://img.shields.io/badge/platform-DSH%20Web%20Bundle-orange)

## Table of contents

- [The problem it solves](#the-problem-it-solves)
- [Features](#features)
- [Install & enable](#install--enable)
- [Quick start](#quick-start)
- [Project structure](#project-structure)
- [Jump-back & follow-tail guard: optimization history](#jump-back--follow-tail-guard-optimization-history)
- [Data & privacy](#data--privacy)
- [Diagnostics & troubleshooting](#diagnostics--troubleshooting)
- [Development commands](#development-commands)
- [FAQ](#faq)
- [Security](#security)
- [License](#license)

## The problem it solves

Once a conversation scrolls to hundreds or thousands of lines, finding an earlier
turn by hand is slow and makes you lose your place. dsh-redmark lets you:

1. Bookmark any assistant reply or text selection with a custom note;
2. Jump back to that turn from the sidebar panel, a right-side tab, or a header
   utility button;
3. Search within the current conversation with `Ctrl/Cmd+F`, using the same
   precise landing mechanism.

It also fixes a long-standing follow problem: **while a reply streams, the view
silently stops following the tail and slides back to your own last message**.
That comes from a layout coupling between DSH's scroll anchors and the bookmark
trigger — see the [optimization history](#jump-back--follow-tail-guard-optimization-history).

## Features

| Feature | Description |
| --- | --- |
| Turn bookmarks | Bookmark an assistant reply from its message toolbar (order 40); stores `turn` / `seq` / note |
| Text-range bookmarks | Highlight a selection via the CSS Custom Highlight API; stores quote, offsets, and prefix/suffix context; lands on the quoted passage, not the whole turn |
| Dedicated panel | `sidebar.panellist` + main panel + right-side tab, multiple entry points |
| Precise jump-back | Session-scoped queries + DSH's own scroll anchors (Plan C) and TurnNavigator rail — never writes synthetic scroll events; handles huge / still-loading sessions |
| Find in conversation | `Ctrl/Cmd+F` capture-phase shortcut that never steals keystrokes from input fields; highlighted, step-wise navigation |
| Follow-tail guard | Repairs intentless pin drops under narrow conditions, respects deliberate reader scrolling, capped at 200 repairs |
| Best-effort persistence | `localStorage` as primary store; optional JSON mirror through the Host `/dsh-redmark` route |
| Structured diagnostics | Jump/guard metrics written to `dsh-redmark-trace.log`, with 1 MiB rotation |

## Install & enable

This repository is a local DSH Cordis bundle with zero npm dependencies. Key
`package.json` fields:

```json
{
  "name": "@local/dsh-redmark",
  "version": "4.0.9",
  "type": "module",
  "dsh": {
    "bundle": { "patch": "./cordis.patch.yml" },
    "client": {
      "platform": "web",
      "immediately": true,
      "inject": ["@deepseek-ai/dsh-client-ui-conversation"]
    }
  }
}
```

- `cordis.patch.yml` inserts `id: dsh-redmark` / `name: '@local/dsh-redmark'` into DSH.
- `immediately: true` injects the web client as soon as the conversation UI loads.
- `client.js` is loaded via `window.__ModuleLoader__.load({ id, factory })`; React
  and React-DOM are provided by the host.

**Local development install (directory junction).** Place the repository in your
workspace, create a directory junction in the profile pointing at it, then reload
DSH — no copying needed. On the development machine the junction is configured as:

```text
C:\Users\EDY\.dsh\profiles\desktop\node_modules\@local\dsh-redmark
  → C:\Users\EDY\Documents\deepseek-harness\default-workspace\dsh-redmark
```

To recreate it on another machine (replace the paths with your actual repository
location; open PowerShell as Administrator):

```powershell
$repo = "C:\Users\EDY\Documents\deepseek-harness\default-workspace\dsh-redmark"
$link = "$env:USERPROFILE\.dsh\profiles\desktop\node_modules\@local\dsh-redmark"
New-Item -ItemType Directory -Force (Split-Path $link)
cmd /c mklink /J "$link" "$repo"
```

Then reload the bundle in DSH (or restart DSH) for it to take effect.

## Quick start

1. **Bookmark**: hover an assistant message in a long conversation and click the
   bookmark action in its toolbar (or select text and use the selection menu),
   then enter a note and save (≤ 2000 chars; max 500 per session).
2. **Open the panel**: use the header utility button, the panel list in the
   sidebar, or the `dsh-redmark` tab on the right side.
3. **Jump back**: click any bookmark. The engine reuses DSH's navigation rail and
   scroll anchors, pages in older history when needed, and lands precisely on
   the target turn.
4. **Find**: focus the transcript and press `Ctrl/Cmd+F` to open the find bar;
   matching turns are highlighted and navigable step by step.
5. **Export / recover**: the authoritative copy lives in browser `localStorage`;
   if the Host route is available it is also mirrored to
   `%USERPROFILE%\.dsh\dsh-redmark.json` (or `<DSH_HOME>`).

## Project structure

This is a **JS ESM DSH bundle**, so Python-specific template entries are adapted
to the DSH ecosystem (`pyproject.toml` → `package.json`,
`src/your_package/` → root-level `index.js` / `client.js`):

| Template entry | This project | Notes |
| --- | --- | --- |
| `.github/workflows/ci.yml` | ✅ `.github/workflows/ci.yml` | checkout@v4 + setup-node@20; runs structure check and tests |
| `docs/` | ✅ `docs/architecture.md`, `docs/usage.md` | Architecture (incl. jump-back) and usage/troubleshooting docs |
| `scripts/` | ✅ `scripts/check-bundle.js` | Zero-dependency manifest validator: files present, manifest correct, JS parseable |
| `src/your_package/` | ✅ `index.js` + `client.js` | Host half / Web half entry points (DSH bundle layout) |
| `tests/` | ✅ `test/bundle.test.js`, `test/README.md` | 7 `node:test` cases guarding the bundle's structural contract |
| `.env.example` | ✅ `.env.example` | Directory variables only (`DSH_HOME` etc.), **no secrets** |
| `.gitignore` | ✅ `.gitignore` | Ignores runtime JSON/logs, `.env`, `client.js.bak*` |
| `CHANGELOG.md` | ✅ `CHANGELOG.md` | Keep a Changelog + SemVer, records optimization rounds |
| `CONTRIBUTING.md` | ✅ `CONTRIBUTING.md` | Development, guard-modification rules, commit hygiene |
| `LICENSE` | ✅ `LICENSE` | MIT |
| `README.md` | ✅ this file | English entry point; `README.zh-CN.md` is the Chinese edition |
| `pyproject.toml` | ♻️ `package.json` | DSH bundle manifest (name/version/exports/files/dsh) |
| `Dockerfile` | ⭕ N/A | The plugin runs inside the DSH desktop process; no container |

Additional bundle runtime files: `cordis.patch.yml`, `icon.svg`,
`locale/en.json`, `locale/zh.json`.

The only differences from the Python template: the "source" lives at the repo
root (two entry points, Host and Web) per Cordis convention rather than under
`src/`, and there is no `Dockerfile` because the plugin is not deployed
standalone.

## Jump-back & follow-tail guard: optimization history

This is the core of the project's many tuning rounds. Diagnostic evidence lives
at `%USERPROFILE%\.dsh\dsh-redmark-trace.log` (plus `.bak-*` rotation backups).

**Problem 1: the view silently stops following the tail.** While a reply streams
and `scrollHeight` grows, the layout change from mounting the bookmark trigger
is interpreted by DSH as "reader scrolled", so `followingTail` is dropped and
the view slides back to your last message.

- Measured: mounting the trigger as a slot box inside the scroll flow added
  32–96 px per mount, exceeding DSH's 24 px follow tolerance. Fix: mount the
  trigger as a flex item in the toolbar's **already-reserved 28 px row**, so it
  no longer grows the transcript.
- Guard: `startFollowGuard()` re-pins only when **all** narrow conditions hold —
  the anchor was on then off, no reader intent within 700 ms, near the tail
  (`gap < 600`), cooldown > 1.2 s, and no jump in flight (`jumpInFlight=false`).
  Deliberate reader scrolling (`intentless=false`) is never repaired.
- Deliberately avoided: no gap-based repair (an idle pinned view already has a
  ~240 px gap from the collapsed input area); no streaming requirement (the pin
  drop commonly appears 0.62 s after mount); a 200-repair cap, after which the
  guard stays pass-through until reload.

**Problem 2: cross-turn jumps were inaccurate / flickered.**

- `railTurnOf` now reads the **trailing number** of the rail item's
  `aria-label` — localized labels may contain another digit, and matching the
  whole label broke every cross-turn jump.
- The `TurnNavigator`'s `onNavigate(item)` is resolved through the React fiber
  and called directly; the rail is never clicked or scrolled (two writers caused
  flicker). `jumpViaRail` holds `jumpInFlight` for the whole request so a
  concurrent re-pin cannot cancel DSH's pending navigation.
- `jumpToTurn` prefers DSH's own scroll anchors (Plan C: `save(null)` to return
  to the tail, `save(position)` to pin), falling back to the legacy pager only
  when no rail handle exists; it pages in up to 240 pages when necessary, then
  bisects the scrollport with 48 probes to land precisely. All queries are scoped
  to the target session (`[data-conversation-session="<id>"]`), so cross-session
  jumps no longer land in the wrong conversation.
- **Text bookmarks land on the passage, not the turn row.** The jump still pages
  the Turn into view but skips turn-row centring; `revealQuotedNode` then walks
  the scrollport to the quoted paragraph. A stored node's kind+step is used to
  disambiguate short quotes that also appear in reasoning nodes, and the reader's
  scroll anchor is snapshotted and restored around the walk.
- **Huge / still-loading sessions.** Mount waits use a 30 s wall-clock deadline
  and check the session snapshot's `openState` (the shell leaves the Chat flow
  unmounted while `loading`); a session still loading at the deadline gets a
  specific "still loading" toast. The passage walk is progress-bounded with a
  stall detector instead of a fixed 12-screen cap — a bookmark in a multi-screen
  Turn now reaches its passage in one click. Paging and walking are alternated
  up to four rounds, and the success toast reflects the passage walk's result.

**Sample diagnostics** (from a real trace, showing the mechanism at work):

```
guard: arm growth=0 bm=4 spots=4,-715 rows=431 pinned=true   <- mount does not grow the view
guard drop: gap=300 intentless=true nearTail=true ...        <- intentless pin drop
guard: re-pin after intentless drop (gap=300 restore#1)      <- narrow-condition repair
reveal align ok=true turn=63 before=... after=...            <- correct jump alignment
```

See [docs/architecture.md](docs/architecture.md) for the full mechanism and
criteria.

## Data & privacy

| Data | Location | Nature |
| --- | --- | --- |
| Bookmark store (authoritative) | browser `localStorage` key `dsh.dsh-redmark.<sessionId>` | Per-session, authoritative |
| Durability mirror | `%USERPROFILE%\.dsh\dsh-redmark.json` (or `$DSH_HOME`) | Best-effort, 16 MiB cap; works even if the route is unavailable |
| Diagnostic log | `%USERPROFILE%\.dsh\dsh-redmark-trace.log` | Structural metrics only, 1 MiB rotation |
| Recovery backups | `.erased-*`, `*.corrupt`, `*.bak-*` | Protection against erase/corruption |

- The plugin **reads no API keys** and sends data only to its own same-origin
  `/dsh-redmark` route.
- The Host endpoint is strictly best-effort: if `webServer` is unavailable at
  apply time, it logs `dsh-redmark: webServer unavailable, durability mirror
  disabled` and keeps working from `localStorage`.
- Writes use a temporary file + `rename` for atomic persistence; a parse
  failure renames the file to `*.corrupt` rather than silently clearing it.

## Diagnostics & troubleshooting

View recent log lines (copy-paste ready):

```powershell
Get-Content "$env:USERPROFILE\.dsh\dsh-redmark-trace.log" -Tail 120
```

| Symptom | Key trace fields | Action |
| --- | --- | --- |
| Inaccurate jump | `reveal align ok=false` / `no-landing` | Check that a rail handle exists and the session was not switched |
| Sliding back again | `intentless=false` in `guard drop` | A deliberate reader scroll — the guard correctly stands down; no action needed |
| Repeated re-pinning | `guard: repair cap reached (200)` | Intervention already stopped automatically; reload DSH to reset |
| "Still loading" toast | `openState=loading` in `jump: root gate` | The huge session is not open yet; wait for it to finish loading and click again |
| "Quoted passage not loaded" | `jump: quote centred ok=false` | The walk was bounded; scroll a little into that Turn so the passage paints, or click again to page more history |
| Mirror not working | No route in log / `durable=false` | Only affects cross-browser recovery; `localStorage` still works |

See [docs/usage.md](docs/usage.md), "Reading the diagnostic trace", for details.

## Development commands

Node may not be on `PATH` in the DSH environment; use the bundled Node (v24.x).
These commands are copy-paste ready (adjust paths for your machine):

```powershell
$node = "C:\Users\EDY\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe"
$proj = "C:\Users\EDY\Documents\deepseek-harness\default-workspace\dsh-redmark"

& $node --check "$proj\client.js"
& $node --check "$proj\index.js"
& $node "$proj\scripts\check-bundle.js"
& $node --test --experimental-test-isolation=none "$proj\test\bundle.test.js"
```

Expected output:

```
Bundle check OK: @local/dsh-redmark@4.0.9
# 8 tests passed
```

> `--experimental-test-isolation=none` is only needed inside the DSH sandbox,
> where the default test-isolation subprocess spawn is rejected with
> `Error: spawn EPERM`. Plain CI (`node --test test/*.test.js`) does not need it.

CI (GitHub Actions, Node 20) runs `scripts/check-bundle.js` and
`node --test test/*.test.js` on every push and pull request.

## FAQ

**Q: Why no `pyproject.toml` / `src/` / `Dockerfile`?**
A: This is a DSH Cordis **JS bundle**, not a Python service. The equivalents are
`package.json` and root-level `index.js` / `client.js`; the plugin runs inside
the DSH desktop process and needs no container.

**Q: Jumping into a very large session fails with "still loading" / the quote is not shown.**
A: The shell leaves the Chat flow unmounted until the session finishes loading
(`openState === 'open'`). dsh-redmark now waits up to 30 s for that state; if the
session is still loading at the deadline, wait a moment and click the bookmark
again. Text bookmarks use a progress-bounded passage walk (plus up to four
paging rounds), so a passage deep inside a huge Turn is reached in one click in
most cases; if the toast says the quote is not loaded yet, scroll a little into
that Turn so the passage paints, then click again.

**Q: Will deleting the trace log lose bookmarks?**
A: No. Bookmarks live in `localStorage` (plus the optional JSON mirror); the log
is for diagnostics only.

**Q: Will bookmarks survive a browser switch?**
A: `localStorage` does not cross browsers. If the Host route is available the
JSON mirror can help recover them — do not treat the JSON as the only copy.

## Security

- `.env.example` contains directory variables only; never put secrets in it.
- The route verifies same-origin (`sec-fetch-site` / `origin`); records are
  sanitized server-side, with length caps on notes and text.
- Diagnostics swallow all failures and never interrupt functionality; the log
  contains no conversation text or secrets.
- Do not commit `dsh-redmark.json`, trace logs, `.env`, or `client.js.bak*`
  (covered by `.gitignore`).

## License

MIT — see [LICENSE](LICENSE).
