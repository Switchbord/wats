# VOICE.md — how wats writes

This file is the contract for every word that ships: site copy, docs, READMEs,
error messages, test names, CLI output. CI enforces the mechanical parts
(`site/scripts/check-banned-phrases.ts`). Humans and agents enforce the rest.

## The register

Write like an operator who has been paged at 3am and lived. Professional,
terse, occasionally dry. The reader is a developer with a terminal open and
limited patience. Respect both.

Dark humor is allowed in small doses where it carries information ("Meta will
retry the webhook until you acknowledge it or die"). It is seasoning, not the
meal. One wry line per page is plenty. Zero is fine.

## Hard rules (CI-enforced where possible)

1. No marketing adjectives. "blazingly fast", "powerful", "seamless",
   "delightful", "robust", "comprehensive", "best-in-class" — delete on sight.
   If the thing is fast, show a number. If it's small, show the bytes.
2. No exclamation points. No emoji. (Already gated.)
3. No LLM filler: "It's important to note", "In order to", "Let's dive in",
   "Additionally," as a paragraph opener, "leverage" as a verb, "utilize" ever.
4. No internal archaeology in public surfaces. Ticket IDs (WATS-nn), phase
   labels (F-4, B2, Arch-K), "closes ...", "adversarial remediation",
   reviewer-gate jargon — these live in Linear and commit messages, not docs.
   A doc describes what the code DOES, not the meeting where it was decided.
5. No restating the obvious. A section titled "Purpose" that says "Define the
   public client API surface" under a page titled "Client Reference" is two
   sentences of nothing. Cut it.
6. Every capability claim keeps its honesty tag where status matters:
   live-validated / shape-only / planned. Honesty is the brand. Dark humor
   never blurs what actually works.

## Style mechanics

- Lead with the code. Prose explains what the snippet doesn't say by itself.
- Sentences under ~25 words. Paragraphs under ~4 sentences. Tables for facts,
  prose for judgment.
- Second person, active voice. "You get a typed error" not "A typed error is
  returned to the caller".
- Error docs say what went wrong, what the blast radius is, and what to do.
  In that order.
- If a section can be deleted without a reader losing the ability to ship,
  delete it. The docs are a tool, not a museum.

## Examples

Bad:  "WATS provides a comprehensive, robust error taxonomy that empowers
       developers to seamlessly handle failures (closes WATS-13 / L7)."
Good: "Every Graph failure maps to a typed error class. Catch by `instanceof`,
       not by parsing Meta's prose — Meta's prose changes."

Bad:  "## Purpose — Define the public client API surface for WATS."
Good: (deleted)

Bad:  "It's important to note that the access token must not contain control
       characters."
Good: "Control characters in a token throw at construction. Better there than
       in a request header."
