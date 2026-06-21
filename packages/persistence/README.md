# @wats/persistence

Experimental WATS persistence contracts and adapters.

Install:

```bash
bun add @wats/persistence
npm i @wats/persistence
```

Current scope:

- root persistence interfaces
- SQLite local-development adapter target
- optional Postgres adapter subpath (`@wats/persistence/postgres`)
- forward-only migration runner
- redacted health diagnostics

SQLite is intended for local and single-instance testing. Postgres is optional: install `pg` yourself and import `createPostgresPersistence` from `@wats/persistence/postgres`. Conversation APIs, CLI thread navigation, and status UI wiring are tracked as follow-up WATS issues.

Docs: https://wats.sh/docs/reference/persistence
License: MIT
