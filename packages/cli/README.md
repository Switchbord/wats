# @switchbord/cli

Alpha WATS package. See the repository README and docs at https://github.com/switchbord/wats.

Useful commands:

```bash
wats init --dry-run
wats onboarding --public-url https://example.test/wats
wats webhook token
```

`wats onboarding` prints the webhook callback address plus generated local `WATS_VERIFY_TOKEN` / `WATS_SERVICE_TOKEN` values and names the Meta-side credentials the user must provide. It does not call Meta Graph APIs or read existing live credentials.
