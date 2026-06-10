import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/')({
  component: Home,
})

function Home() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-bg">
      <h1 className="mono text-5xl font-semibold text-text">
        wats<span className="text-accent">_</span>
      </h1>
    </main>
  )
}
