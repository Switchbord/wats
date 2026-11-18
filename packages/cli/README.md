# @wats/cli

Safe local operator CLI for WATS onboarding, config validation, diagnostics, package upgrades, OpenAPI export, dry-run service checks, and webhook setup helpers.

## Install

```bash
bun add @wats/cli@0.5.0-beta
npm i @wats/cli@0.5.0-beta
```

## Usage

```bash
bunx --bun @wats/cli@0.5.0-beta --help
bunx --bun @wats/cli@0.5.0-beta --version
bunx --bun @wats/cli@0.5.0-beta setup
bunx --bun @wats/cli@0.5.0-beta doctor --config wats.config.yaml --check-env
bunx --bun @wats/cli@0.5.0-beta upgrade --dry-run
bunx --bun @wats/cli@0.5.0-beta upgrade
bunx --bun @wats/cli@0.5.0-beta onboarding --public-url https://example.test/wats
bunx --bun @wats/cli@0.5.0-beta serve --config wats.config.yaml --dry-run --print-routes
WATS_LIVE_ENABLE=1 WATS_YES_LIVE=1 \
  bunx --bun @wats/cli@0.5.0-beta serve --config wats.config.yaml --live --yes-live --env-file .env.local
```

`wats setup` writes env-secret references to `wats.config.yaml` and local values to ignored `.env.local`. Secret prompts explain when input is hidden. Default commands do not call Meta Graph APIs or validate credentials against Meta. For live webhook testing, expose the local port with ngrok or another secure HTTPS tunnel; Meta requires HTTPS callback URLs.

Docs: https://wats.sh/docs/reference/cli
License: MIT

`upgrade` delegates to `bun update --latest`; it does not select the beta channel.
For this beta, install the explicit `@0.5.0-beta` package versions. npm’s
`latest` tag intentionally remains at `0.4.0-beta.0`.
