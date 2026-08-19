"use client"

import { useState, Suspense } from "react"
import { signIn } from "next-auth/react"
import { useRouter, useSearchParams } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card } from "@/components/ui/card"
import { WayfinderLogo } from "@/components/wayfinder/wayfinder-logo"
import { Loader2, ArrowRight, Sparkles, ShieldCheck, User as UserIcon } from "lucide-react"
import { toast } from "sonner"

const DEMO_ACCOUNTS = [
  {
    label: "Demo: User (Kenya software engineer)",
    email: "demo-user@wayfinder.app",
    password: "wayfinder",
    icon: UserIcon,
    desc: "Full mobility planner experience",
  },
  {
    label: "Demo: Admin",
    email: "demo-admin@wayfinder.app",
    password: "wayfinder",
    icon: ShieldCheck,
    desc: "Approve waitlist & create accounts",
  },
]

function LoginForm() {
  const router = useRouter()
  const params = useSearchParams()
  const callbackUrl = params.get("callbackUrl") || "/"

  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [loading, setLoading] = useState(false)
  const [demoLoading, setDemoLoading] = useState<string | true | null>(null)

  const handleSignIn = async (e: React.FormEvent, creds: { email: string; password: string }, demoKey?: string) => {
    e.preventDefault()
    const setter = (demoKey ? setDemoLoading : setLoading) as (v: boolean | string | null) => void
    setter(true)
    const res = await signIn("credentials", {
      email: creds.email,
      password: creds.password,
      redirect: false,
    })
    setter(false)
    if (res?.error) {
      toast.error("Invalid email or password.")
      return
    }
    toast.success("Welcome to Wayfinder.")
    router.push(callbackUrl)
    router.refresh()
  }

  return (
    <div className="relative min-h-screen overflow-hidden">
      <div className="wf-topo absolute inset-0 -z-10 opacity-70" />
      <div className="absolute inset-0 -z-10 bg-gradient-to-b from-transparent via-background/40 to-background" />

      <div className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-4 py-12">
        <div className="mb-8 text-center">
          <div className="mb-4 inline-flex h-12 w-12 items-center justify-center rounded-xl border border-border/60 bg-card/70 wf-panel">
            <WayfinderLogo className="h-7 w-7 text-primary" animated />
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">Welcome back</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Sign in to continue mapping your mobility.
          </p>
        </div>

        <Card className="border-border/60 bg-card/80 p-5 wf-panel">
          <form onSubmit={(e) => handleSignIn(e, { email, password })} className="space-y-3">
            <div>
              <Label htmlFor="email" className="mb-1.5 text-xs font-medium text-muted-foreground">Email</Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                autoComplete="email"
                required
              />
            </div>
            <div>
              <Label htmlFor="password" className="mb-1.5 text-xs font-medium text-muted-foreground">Password</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                autoComplete="current-password"
                required
              />
            </div>
            <Button type="submit" disabled={loading} className="w-full gap-2">
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
              Sign in
            </Button>
          </form>

          <div className="mt-4 flex items-center gap-2">
            <div className="h-px flex-1 bg-border/60" />
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Quick demo logins</span>
            <div className="h-px flex-1 bg-border/60" />
          </div>

          <div className="mt-3 space-y-2">
            {DEMO_ACCOUNTS.map((acc) => (
              <button
                key={acc.email}
                onClick={(e) => handleSignIn(e, { email: acc.email, password: acc.password }, acc.email)}
                disabled={demoLoading !== null}
                className="flex w-full items-center gap-3 rounded-lg border border-border/60 bg-background/40 px-3 py-2 text-left transition-colors hover:border-primary/40 hover:bg-card disabled:opacity-60"
              >
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                  {demoLoading === acc.email ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <acc.icon className="h-3.5 w-3.5" />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-xs font-medium">{acc.label}</span>
                  <span className="block text-[10px] text-muted-foreground">{acc.desc}</span>
                </span>
              </button>
            ))}
          </div>
        </Card>

        <p className="mt-5 text-center text-xs text-muted-foreground">
          No account yet?{" "}
          <button onClick={() => router.push("/signup")} className="font-medium text-primary hover:underline">
            Join the waitlist
          </button>
        </p>

        <div className="mt-6 flex items-center justify-center gap-1.5 text-[10px] text-muted-foreground">
          <Sparkles className="h-2.5 w-2.5 text-accent" />
          Global Mobility Intelligence · Policy v2024.11.1
        </div>
      </div>
    </div>
  )
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  )
}
