# @wats/cli

Safe local operator CLI for WATS onboarding, config validation, diagnostics, OpenAPI export, dry-run service checks, and webhook setup helpers.

## Install

```bash
bun add @wats/cli
npm i @wats/cli
```

## Usage

```bash
bunx --bun @wats/cli --help
bunx --bun @wats/cli setup
bunx --bun @wats/cli doctor --config wats.config.yaml --check-env
bunx --bun @wats/cli onboarding --public-url https://example.test/wats
bunx --bun @wats/cli serve --config wats.config.yaml --dry-run --print-routes
WATS_LIVE_ENABLE=1 WATS_YES_LIVE=1 \
  bunx --bun @wats/cli serve --config wats.config.yaml --live --yes-live --env-file .env.local
```

`wats setup` writes env-secret references to `wats.config.yaml` and local values to ignored `.env.local`. Secret prompts explain when input is hidden. Default commands do not call Meta Graph APIs or validate credentials against Meta. For live webhook testing, expose the local port with ngrok or another secure HTTPS tunnel; Meta requires HTTPS callback URLs.

Docs: https://github.com/Switchbord/wats
License: MIT
