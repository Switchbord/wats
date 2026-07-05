# Support

WATS is a solo-maintained alpha. Responses are best-effort, not on a clock.

## Where to ask

- **GitHub Discussions** — questions, usage, and design talk. Start here.
- **GitHub Issues** — reproducible bugs and concrete feature requests.
- **`SECURITY.md`** — suspected vulnerabilities. Do not open a public issue for those.

## What to expect

One maintainer, plus AI agents on routine work. Alpha means the surface still shifts within `0.x`. You will not get an SLA, and follow-ups may land days late.

## What makes a good report

A good bug report is reproducible against a published `@wats/*` package with a credential-free `MockTransport` snippet. State the package, version, and the exact Graph request shape or webhook body you sent.

Redact before you paste. Never include live WhatsApp access tokens, app secrets, service bearer values, WABA IDs, phone-number IDs, raw webhook payloads, issue-tracker exports, or customer/user data. Use placeholders such as `WATS_GRAPH_ACCESS_TOKEN` and synthetic IDs.

Feature requests read better as a problem statement than a solution. Name the operator pain and the surface you tried; the maintainer will weigh the shape.
