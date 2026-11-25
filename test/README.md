# Tests

Zero-dependency [`node:test`](https://nodejs.org/api/test.html) assertions that
guard the bundle's structural contract — the same contract DSH relies on when
it installs the plugin.

## Run

From the project root:

```powershell
& "C:\Users\EDY\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe" --test --experimental-test-isolation=none test/*.test.js
```

`--experimental-test-isolation=none` is needed only inside the DSH sandbox,
which blocks the default subprocess spawn with `Error: spawn EPERM`. It is not
required in ordinary CI (see `.github/workflows/ci.yml`).

## What is covered

| Test | Guards |
| --- | --- |
| manifest | `package.json` name/type/private/license/repository, `dsh.bundle.patch`, `dsh.client`, `files[]`, `exports` |
| patch | `cordis.patch.yml` inserts `@local/dsh-redmark` |
| locale | `locale/en.json` and `locale/zh.json` carry meta title/description |
| host | `index.js` injects `webServer`, declares the route and size-limit constants |
| client | `client.js` registers the panel, slots, and jump-back/guard machinery |
| session-scoped jumps | `sessions` inject, `sessionRoot` selector, `openState` waits, `still-loading`, and passage-centring helpers (`centrePassage`, `revealQuotedNode`, node step disambiguation) |
| migration | older localStorage keys and mirror files are adopted, not dropped |
| secrets | `.env.example` contains no real keys |
