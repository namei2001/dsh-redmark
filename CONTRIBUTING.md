# Contributing to dsh-redmark

Thanks for helping improve dsh-redmark (formerly *Session Bookmarks*). This
bundle plugs into [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)
via its Cordis web-bundle API, so a few conventions matter.

## Development setup

1. Use Node.js 18 or newer. In the DSH desktop environment a bundled Node is
   available at
   `C:\Users\EDY\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe`
   (v24.x); it is not necessarily on `PATH`.
2. From the project root, install nothing — the bundle has zero npm dependencies.
3. Validate a change with:

   ```powershell
   & "C:\Users\EDY\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe" --check client.js
   & "C:\Users\EDY\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe" --check index.js
   & "C:\Users\EDY\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe" scripts/check-bundle.js
   & "C:\Users\EDY\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe" --test --experimental-test-isolation=none test/*.test.js
   ```

   The `--experimental-test-isolation=none` flag is only needed inside the DSH
   sandbox, which blocks the default test-isolation subprocess spawn (`EPERM`).
   In plain CI (`node --test test/*.test.js`) it can be omitted.

## Editing the Web half

`client.js` is loaded through `window.__ModuleLoader__.load({ id, factory })`.
It uses React/React-DOM supplied by the host; there is no `host/styles` or
`console` specifier, so CSS is injected with a plain `<style>` element. Keep all
new UI inside the existing slot registrations in `apply(ctx)` and wrap each
registration in `try/catch` so one missing slot never disables the rest.

## Editing the Host half

`index.js` registers a best-effort `/dsh-redmark` webServer prefix route.
It must never become a hard dependency: if the route is unavailable the Web half
still works from `localStorage`. Preserve the sanitization, erase protection,
write-failure (`507`) behavior, and the legacy `session-bookmarks.json` fallback
when changing the handler/loader.

## Jump-back / follow-tail guard

This area was tuned over many rounds against a diagnostic trace. Before
changing `startFollowGuard`, `jumpViaRail`, `railTurnOf`, or `jumpToTurn`:

- Read `docs/architecture.md` for the mechanism and the measured root causes.
- Reproduce from the trace at
  `C:\Users\EDY\.dsh\dsh-redmark-trace.log` (see `docs/usage.md`).
- Keep repairs narrow: only repair pin drops that are intentless, near-tail,
  quiet, cooled down, and not during an in-flight jump. Never write synthetic
  scroll positions or fake scroll events.

## Commit hygiene

- Do not commit runtime data (`dsh-redmark.json`, `dsh-redmark-trace.log`,
  legacy `session-bookmarks*.json`/`.log`), `.env`, or `client.js.bak*` backups.
- Update `CHANGELOG.md` for behavior changes.
- Keep the README in sync when adding a slot, command, or config key.
- The bundle id, route, and storage prefix are a contract with installed users:
  never rename them without a legacy migration path.
