#!/usr/bin/env bun
// scripts/audit-tdd.ts
//
// Advisory TDD RED -> GREEN auditor introduced in F-0 of the WATS
// foundations pivot. Walks the recent git log and emits PASS / WARN /
// ADVISORY lines per ADR-006's RED -> GREEN commit discipline.
//
// Exit status:
//   - Default: 0 (advisory). The script never fails the build in F-0.
//   - With --strict: 1 if any WARN or ADVISORY line is emitted.
//     --strict is wired by F-3 once the team has had one release cycle
//     to measure noise.
//
// Usage:
//   bun scripts/audit-tdd.ts [--limit=N] [--strict]
//
// No external dependencies. `node:child_process` is allowed in scripts/
// because scripts/ runs under Node / Bun only, never in an Edge runtime.

import { spawnSync } from "node:child_process";

interface Commit {
  readonly sha: string;
  readonly subject: string;
  readonly body: string;
}

interface ParsedArgs {
  readonly limit: number;
  readonly strict: boolean;
}

function parseArgs(argv: readonly string[]): ParsedArgs {
  let limit = 50;
  let strict = false;
  for (const arg of argv) {
    if (arg === "--strict") {
      strict = true;
      continue;
    }
    if (arg.startsWith("--limit=")) {
      const raw = arg.slice("--limit=".length);
      const parsed = Number.parseInt(raw, 10);
      if (Number.isFinite(parsed) && parsed > 0 && parsed <= 10_000) {
        limit = parsed;
      }
      continue;
    }
  }
  return { limit, strict };
}

function readGitLog(limit: number): Commit[] {
  // Each commit: SHA\nSUBJECT\nBODY\n--END--\n
  const result = spawnSync(
    "git",
    [
      "--no-pager",
      "log",
      `-n${limit}`,
      "--format=%H%n%s%n%b%n--END--"
    ],
    { encoding: "utf8" }
  );

  if (result.status !== 0) {
    throw new Error(
      `git log failed with exit code ${result.status}: ${result.stderr ?? ""}`
    );
  }

  const raw = result.stdout;
  const commits: Commit[] = [];
  const blocks = raw.split(/^--END--$/m);
  for (const block of blocks) {
    const trimmed = block.replace(/^\n+/, "").replace(/\n+$/, "");
    if (trimmed.length === 0) {
      continue;
    }
    const lines = trimmed.split("\n");
    const shaLine = lines[0];
    const subjectLine = lines[1];
    if (typeof shaLine !== "string" || shaLine.length === 0) {
      continue;
    }
    if (typeof subjectLine !== "string") {
      continue;
    }
    const bodyLines = lines.slice(2);
    commits.push({
      sha: shaLine,
      subject: subjectLine,
      body: bodyLines.join("\n")
    });
  }

  // git log returns newest-first; we want newest-first for "last N" windows
  // over preceding commits.
  return commits;
}

function isRedTestSubject(subject: string): boolean {
  if (!subject.startsWith("test(")) {
    return false;
  }
  return /\bRED\b/.test(subject) || /\(RED\)/.test(subject);
}

function isFeatOrFixSubject(subject: string): boolean {
  return subject.startsWith("feat(") || subject.startsWith("fix(");
}

function extractPackageScope(subject: string): string | null {
  const match = /^(?:test|feat|fix)\(([^)]+)\)/.exec(subject);
  if (match === null) {
    return null;
  }
  const scope = match[1];
  return typeof scope === "string" && scope.length > 0 ? scope : null;
}

function countFencedCodeBlockLines(body: string): number {
  const lines = body.split("\n");
  let inside = false;
  let count = 0;
  for (const line of lines) {
    if (/^\s*```/.test(line)) {
      inside = !inside;
      continue;
    }
    if (inside) {
      count += 1;
    }
  }
  return count;
}

function hasBatteryOutcomeMarker(body: string): boolean {
  const lowered = body.toLowerCase();
  return (
    lowered.includes("battery outcome") ||
    lowered.includes("adversarial battery") ||
    lowered.includes("section 1:") ||
    /\bsections?\s+1[-–—]/i.test(body)
  );
}

interface AuditResult {
  readonly pass: readonly string[];
  readonly warn: readonly string[];
  readonly advisory: readonly string[];
}

function auditCommits(commits: readonly Commit[]): AuditResult {
  const pass: string[] = [];
  const warn: string[] = [];
  const advisory: string[] = [];

  for (let index = 0; index < commits.length; index += 1) {
    const commit = commits[index];
    if (commit === undefined) {
      continue;
    }
    const shortSha = commit.sha.slice(0, 10);

    if (isRedTestSubject(commit.subject)) {
      const fencedLineCount = countFencedCodeBlockLines(commit.body);
      if (fencedLineCount >= 3) {
        pass.push(
          `PASS: ${shortSha} RED test commit has fenced failing-output block (${fencedLineCount} lines) :: ${commit.subject}`
        );
      } else {
        warn.push(
          `WARN: ${shortSha} RED test commit is missing a fenced failing-output excerpt (>= 3 lines required) :: ${commit.subject}`
        );
      }
      continue;
    }

    if (isFeatOrFixSubject(commit.subject)) {
      const scope = extractPackageScope(commit.subject);
      // Look backward in time (newer-first list; "preceded within last 5
      // commits in the same package" maps to searching indices > current,
      // i.e. older commits, because git log is newest-first).
      let sawRed = false;
      if (scope !== null) {
        const windowEnd = Math.min(commits.length, index + 1 + 5);
        for (let back = index + 1; back < windowEnd; back += 1) {
          const candidate = commits[back];
          if (candidate === undefined) {
            continue;
          }
          if (!isRedTestSubject(candidate.subject)) {
            continue;
          }
          const candidateScope = extractPackageScope(candidate.subject);
          if (candidateScope !== null && scope !== null && candidateScope === scope) {
            sawRed = true;
            break;
          }
          // Also accept cross-scope RED for F-series umbrella commits
          // like test(f-0) paired with feat(f-0).
          if (candidateScope === scope) {
            sawRed = true;
            break;
          }
        }
      }

      if (sawRed) {
        pass.push(
          `PASS: ${shortSha} ${commit.subject.startsWith("feat(") ? "feat" : "fix"} commit is preceded by a matching RED :: ${commit.subject}`
        );
      } else {
        advisory.push(
          `ADVISORY: ${shortSha} ${commit.subject.startsWith("feat(") ? "feat" : "fix"} commit has no matching RED in the prior 5 same-scope commits :: ${commit.subject}`
        );
      }

      if (hasBatteryOutcomeMarker(commit.body)) {
        pass.push(
          `PASS: ${shortSha} GREEN commit body contains battery-outcome marker :: ${commit.subject}`
        );
      } else {
        advisory.push(
          `ADVISORY: ${shortSha} GREEN commit body is missing a battery-outcome marker (look for "Adversarial battery" or "battery outcome") :: ${commit.subject}`
        );
      }
      continue;
    }
  }

  return { pass, warn, advisory };
}

function main(): number {
  const args = parseArgs(Bun.argv.slice(2));
  const commits = readGitLog(args.limit);
  const result = auditCommits(commits);

  for (const line of result.pass) {
    console.log(line);
  }
  for (const line of result.advisory) {
    console.log(line);
  }
  for (const line of result.warn) {
    console.log(line);
  }

  const totals =
    `audit-tdd: scanned=${commits.length} pass=${result.pass.length}` +
    ` advisory=${result.advisory.length} warn=${result.warn.length}` +
    ` mode=${args.strict ? "strict" : "advisory"}`;
  console.log(totals);

  if (args.strict && (result.warn.length > 0 || result.advisory.length > 0)) {
    return 1;
  }
  return 0;
}

const exitCode = main();
process.exit(exitCode);
