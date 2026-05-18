# @wats/cli

Alpha WATS package. See the repository README and docs at https://github.com/Switchbord/wats.

Useful commands:

```bash
wats init --dry-run
wats onboarding --public-url https://example.test/wats
wats serve --config wats.config.yaml --dry-run --host 127.0.0.1 --port 3000
wats serve --config wats.config.yaml --dry-run --print-routes
wats webhook token
```

`wats onboarding` prints the webhook callback address plus generated local `WATS_VERIFY_TOKEN` / `WATS_SERVICE_TOKEN` values and names the Meta-side credentials the user must provide. It does not call Meta Graph APIs or read existing live credentials.

`wats serve --dry-run` starts the local `@wats/service` app with synthetic in-memory secrets and a no-network Graph transport. It does not resolve env-secret values, read `.env.local`, or call Meta Graph APIs. Credential-gated live serve mode remains future work.
