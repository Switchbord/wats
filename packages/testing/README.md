# @wats/testing

`@wats/testing` is a private workspace package for WATS repository tests, policy locks, fixtures, and external-consumer smoke projects. It is not published to npm and is not a supported application dependency.

## @wats/testing version policy

`@wats/testing` intentionally follows its own workspace-only version line. It may remain at a different version from the public `@wats/*` packages because:

- it is marked `private: true` and must not be published;
- it keeps `workspace:*` dependencies that are valid only inside the monorepo;
- it hosts release-contract tests, docs-lock tests, and consumer fixtures for the publishable packages;
- it is outside the public semver and npm registry contract.

The public package version-alignment contract is enforced by `packages/testing/tests/wats030-release-contract.test.ts`. That contract deliberately excludes this private workspace package.

## Usage

Run tests from the repository root:

```bash
bun test packages/testing/tests/
```

Do not import `@wats/testing` from application code. Use the public packages (`@wats/core`, `@wats/graph`, `@wats/http`, `@wats/config`, `@wats/service`, and `@wats/cli`) instead.
