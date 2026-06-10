import { createFileRoute } from "@tanstack/react-router"
import type { ReactNode } from "react"
import { CodeBlock } from "../components/CodeBlock"
import { FeatureCard } from "../components/FeatureCard"
import { SiteFooter } from "../components/SiteFooter"
import { SiteNav } from "../components/SiteNav"
import { StatusTag } from "../components/StatusTag"
import { TerminalPanel } from "../components/TerminalPanel"
import { TrustStrip } from "../components/TrustStrip"

// TODO(T24): delete this route (or keep — it renders null outside dev).
export const Route = createFileRoute("/dev-components")({
  component: DevComponents,
})

const SAMPLE_CODE = `import { GraphClient } from "@wats/graph";

const client = new GraphClient({ accessToken: "demo" });
await client.messages.sendText({ to: "15550001111", text: "hello" });`

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="mono text-sm text-text-muted">{title}</h2>
      {children}
    </section>
  )
}

function DevComponents() {
  if (!import.meta.env.DEV) return null
  return (
    <main className="min-h-screen bg-bg text-text">
      <SiteNav />
      <div className="mx-auto max-w-[1152px] space-y-12 px-4 py-12">
        <Section title="StatusTag">
          <div className="flex gap-6">
            <StatusTag status="live-validated" />
            <StatusTag status="shape-only" />
            <StatusTag status="planned" />
          </div>
        </Section>
        <Section title="TerminalPanel">
          <TerminalPanel
            tabs={[
              { label: "bot.ts", content: <pre className="text-sm">console.log("tab one")</pre> },
              { label: "captured request", content: <pre className="text-sm">{`{ "method": "POST" }`}</pre> },
            ]}
          />
        </Section>
        <Section title="CodeBlock">
          <CodeBlock code={SAMPLE_CODE} lang="ts" />
        </Section>
        <Section title="TrustStrip">
          <TrustStrip
            items={["1200+ tests passing", "live-validated against Meta", "0 hard dependencies", "Bun-first", "MIT"]}
          />
        </Section>
        <Section title="FeatureCard">
          <div className="grid gap-4 md:grid-cols-3">
            <FeatureCard title="Typed end to end" body="Discriminated unions for every message and webhook shape." href="/docs/reference/errors" status="live-validated" />
            <FeatureCard title="Webhook runtime included" body="Signature verification, envelope normalization, a typed router." href="/docs/reference/webhook-normalizer" status="live-validated" />
            <FeatureCard title="Groups API" body="Implemented and request-shape tested; live validation pending." href="/docs/reference/groups" status="shape-only" />
          </div>
        </Section>
      </div>
      <SiteFooter />
    </main>
  )
}
