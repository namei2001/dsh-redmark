# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [4.0.0] - 2026-11-23 — dsh-redmark

First public GitHub release under the new name `dsh-redmark` (formerly
`@local/session-bookmarks`). Branding, runtime identifiers, storage keys, route,
and the on-disk mirror file are renamed consistently.

### Added
- **Legacy-data compatibility**: bookmarks saved by `@local/session-bookmarks`
  are adopted automatically — legacy localStorage keys (`dsh.session-bookmarks.*`)
  are read and copied forward on first read, and a legacy `session-bookmarks.json`
  mirror file is loaded when no `dsh-redmark.json` exists. No bookmarks are lost
  by the upgrade.
- Standard project scaffolding adapted to a DSH Cordis web bundle:
  `.github/workflows/ci.yml`, `scripts/check-bundle.js`, `test/bundle.test.js`,
  `.gitignore`, `.env.example`, `LICENSE`, `CONTRIBUTING.md`, and `docs/`.
- Repository metadata (`repository`, `homepage`, `bugs`, `keywords`, `license`,
  `author`) pointing at https://github.com/namei2001/dsh-redmark.
- This `README.md` as the single entry point: features, install, template
  mapping, data/privacy, diagnostics, and development commands.

### Changed
- Package id `@local/session-bookmarks` → `@local/dsh-redmark`; bundle insertion
  id `session-bookmarks` → `dsh-redmark`.
- Web route `/session-bookmarks` → `/dsh-redmark`; mirror file
  `session-bookmarks.json` → `dsh-redmark.json`; trace log
  `session-bookmarks-trace.log` → `dsh-redmark-trace.log`.
- localStorage prefix `dsh.session-bookmarks.` → `dsh.dsh-redmark.`; panel,
  right-bar tab, slot ids and UI locale namespace carried the new name.

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
- Structured diagnostic trace mirrored to `session-bookmarks-trace.log`
  (renamed to `dsh-redmark-trace.log` in 4.0.0).

## [3.0.0] - 2026-11-23

### Added
- Initial V5 workbench release: dedicated bookmarks panel, right-side tab,
  header utilities, find bar (Ctrl/Cmd+F), and text-range bookmarks via the CSS
  Custom Highlight API.
