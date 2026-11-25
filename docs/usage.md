# Usage

## Install / enable

dsh-redmark is installed as a DSH Cordis bundle. When developing from this
workspace it is linked into the desktop profile under the `@local/dsh-redmark`
id and `dsh-redmark` folder — see the README for the exact junction path. The
profile entry is a directory junction, so edits to the workspace take effect
after a DSH reload.

For a fresh install, load the project folder as a local bundle.
`cordis.patch.yml` inserts `id: dsh-redmark` / `name: '@local/dsh-redmark'`, and
`package.json` requests immediate Web client load with
`inject: ["@deepseek-ai/dsh-client-ui-conversation"]`.

## Add a bookmark

1. In a conversation, hover an assistant message and use the **bookmark** action
   in its toolbar (order 40). Or select text in the transcript and use the
   selection-menu "bookmark selection" action for a text-range bookmark.
2. Give it a short note (≤ 2000 chars) and save. A `turn` bookmark pins a
   conversation turn; a `text` bookmark additionally captures a quote, offsets,
   and prefix/suffix context.
3. Open the bookmarks panel from the session header utility, the sidebar panel
   list, or the right-side tab. Notes are scoped per session (max 500 each).

## Jump back

Click a bookmark to jump to its turn. The engine:

- scopes every query to the target session (`[data-conversation-session="<id>"]`)
  so a cross-session jump never lands in the wrong conversation;
- waits for a huge session to reach `openState === 'open'` (up to 30 s wall clock)
  instead of giving up while the Chat flow is still unmounted;
- reuses DSH's own scroll anchors (`Plan C`) and navigation rail rather than
  writing scroll positions itself;
- pages in older history if the turn is not yet mounted (up to 240 pages, with
  a 20 s no-progress guard);
- bisects the scrollport to land precisely on the target turn row;
- for a **text** bookmark, skips the turn-row centring and walks the scrollport
  to the quoted passage instead. The walk is progress-bounded (wall clock plus a
  stall detector), and it alternates with paging up to four rounds so a passage
  deep inside a huge Turn is reachable in one click. Landing on the Turn alone
  is never reported as a successful jump if the quote walk failed;
- repaints text-range highlights until the virtualized row is present.

If you deliberately scroll during a jump or switch sessions, the jump aborts
cleanly rather than fighting you.

## Find in conversation

Press `Ctrl/Cmd+F` while the transcript is focused to open the find bar. It
never intercepts typing inside editable fields. Matching turns are highlighted
and navigable with next/previous.

## Data and privacy

| Item | Location | Purpose |
| --- | --- | --- |
| Bookmark store (primary) | browser `localStorage` key `dsh.dsh-redmark.<sessionId>` | Authoritative, per-session bookmarks |
| Legacy store (adopted) | an older `dsh.*.<sessionId>` localStorage key | Adopted and copied forward on first use; left intact |
| Durability mirror | `%USERPROFILE%\.dsh\dsh-redmark.json` (or `<DSH_HOME>/...`) | Best-effort JSON mirror; 16 MiB cap |
| Legacy mirror (adopted) | an older `.dsh\*.json` mirror file | Loaded when `dsh-redmark.json` is absent |
| Diagnostic trace | `%USERPROFILE%\.dsh\dsh-redmark-trace.log` | Structured jump/guard metrics; 1 MiB rotation |
| Erase backup | `<DSH_HOME>/dsh-redmark*.erased-*`, `*.corrupt`, `*.bak-*` | Recovery on erase/corruption |

The Host endpoint is optional: if `webServer` is unavailable at apply time the
plugin logs `dsh-redmark: webServer unavailable, durability mirror disabled`
and continues from `localStorage`. The plugin reads **no API keys** and sends
data only to its own same-origin route (`/dsh-redmark`). Trace lines contain
structural metrics (gap, intent, row counts) — not conversation text or secrets.

## Reading the diagnostic trace

Open the log with:

```powershell
Get-Content "C:\Users\EDY\.dsh\dsh-redmark-trace.log" -Tail 120
```

Representative lines and what they mean:

```
guard: armed (follow-on-drop repair active) pinned=true
guard: arm growth=0 bm=4 spots=4,-715 rows=431 pinned=true
```

The 1.3 s arm-time growth probe must report `growth=0`: the add-bookmark trigger
is out of flow, so mounting it must not grow the transcript.

```
guard drop: gap=300 intentless=true nearTail=true streaming=false cooldown=true jumping=false grew=0 bm=4 rows=431
guard: re-pin after intentless drop (gap=300 restore#1 streaming=false)
```

A repair fires only when *all* narrow conditions hold. When you deliberately
scroll, subsequent `guard drop` lines show `intentless=false` (often with large
`grew=` values such as 192067 or 214493) and **no** re-pin — the reader's intent
is respected.

```
query="s" reset idx=0
scan ranges=227 idx=0
reveal idx=N/227 turn=63 ord=0 have=true
reveal align ok=true turn=63 before=... after=...
step delta=1 idx=N total=32
paint: session=... painted=0 missing=0 supported=true
```

These confirm find/range scanning, turn alignment (`align ok=true`), step
navigation, and highlight painting.

For jumps into large or still-loading sessions and to text bookmarks:

```
jump: root gate openState=open flow=true root=true mounted=session-abc|session-def
jump: turn=63 ok=true pages=8 reason=- kind=text key=14:assistant-step68:76
jump: quote centred ok=true reason=- steps=214 turn=63 key=14:assistant-step68:76
jump: quote not mounted (reason=el) turn=63 round=1, asking the rail to load through it
```

`root gate` shows the session snapshot's `openState` and which sessions are
currently mounted. `quote centred ok=true` means the walk reached the passage;
`ok=false` with `reason=stuck` (scrollport clamped) or `budget` means the reader
should scroll a little into that Turn and click again. `reason=text-missing`
means the stored quote no longer exists. Backups of earlier tuning rounds are
kept next to the live log as `dsh-redmark-trace.log.bak-*`.

## Verification commands

```powershell
$node = "C:\Users\EDY\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe"
& $node --check "C:\Users\EDY\Documents\deepseek-harness\default-workspace\dsh-redmark\client.js"
& $node --check "C:\Users\EDY\Documents\deepseek-harness\default-workspace\dsh-redmark\index.js"
& $node "C:\Users\EDY\Documents\deepseek-harness\default-workspace\dsh-redmark\scripts\check-bundle.js"
& $node --test --experimental-test-isolation=none "C:\Users\EDY\Documents\deepseek-harness\default-workspace\dsh-redmark\test\bundle.test.js"
```
