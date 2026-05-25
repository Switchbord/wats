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
- forward-only migration runner
- redacted health diagnostics

SQLite is intended for local and single-instance testing. Postgres, service integration, conversation APIs, CLI thread navigation, and status UI wiring are tracked as follow-up WATS issues.

Docs: https://github.com/Switchbord/wats
License: MIT
