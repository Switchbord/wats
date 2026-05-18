# Security Policy

WATS is alpha software for WhatsApp operations. It handles webhook signature verification, Graph authorization headers, env-secret references, generated service routes, CLI diagnostics, and user-controlled webhook/message payloads. Treat security reports seriously even when the affected surface is still marked experimental.

## Supported versions

| Version line | Supported |
| --- | --- |
| `0.x` alpha | Security fixes are considered for the active `main` line. |
| older snapshots | Not supported unless a maintainer explicitly backports a fix. |

Public vulnerability handling applies to the active repository line and currently published package line.

## Reporting a vulnerability

Do not open a public issue for suspected vulnerabilities, leaked credentials, bypassable webhook signature checks, token redaction failures, or confidential data exposure.

Report vulnerabilities privately to the maintainers through GitHub Security Advisories when available, or by contacting the project owner directly. Include:

- affected package, version/commit, and public API surface;
- a redacted reproduction with synthetic values only;
- expected vs actual behavior;
- whether the issue needs live Meta credentials to reproduce;
- any logs with secret-bearing values removed.

Never include live WhatsApp access tokens, app secrets, service bearer values, WABA IDs, phone-number IDs, webhook payloads, issue-tracker exports, or customer/user data in the report. Use placeholders such as `WATS_GRAPH_ACCESS_TOKEN` and synthetic IDs.

## Scope examples

Security-relevant surfaces include:

- Webhook signature and challenge verification.
- Graph request path, header, query, body, and URL construction.
- CLI config loading, diagnostics, generated files, and output redaction.
- Service OpenAPI/routes, route collision handling, bearer authentication, and webhook endpoints.
- Env-secret references and config redaction.
- Malformed JavaScript caller inputs: accessors, proxies, sparse arrays, cycles, unsafe prototype keys, control characters, and oversized payloads.

## Live Meta credentials

No live Meta credentials are required for default tests or CI. Live validation campaigns must be explicitly authorized, skipped by default, and run with cleanup/redaction plans. No live Meta credentials, webhook secrets, service bearer tokens, or raw Graph responses should be committed to the repository or attached to public issues.

## Maintainer response expectations

Maintainers should acknowledge confidential reports, reproduce with synthetic or redacted data when possible, track remediation privately until disclosure is safe, and publish a public advisory or changelog note once a fix is available if disclosure is appropriate.

For fixes, prefer regression tests that prove the bypass without revealing sensitive data. Webhook signature, secret comparison, redaction, parser, route, and Graph transport fixes should include adversarial malformed-input coverage and docs updates describing the final safe contract.
