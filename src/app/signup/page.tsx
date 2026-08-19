"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Card } from "@/components/ui/card"
import { WayfinderLogo } from "@/components/wayfinder/wayfinder-logo"
import { Loader2, ArrowRight, CheckCircle2, Clock } from "lucide-react"
import { toast } from "sonner"

export default function SignupPage() {
  const router = useRouter()
  const [email, setEmail] = useState("")
  const [name, setName] = useState("")
  const [intent, setIntent] = useState("")
  const [loading, setLoading] = useState(false)
  const [done, setDone] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    try {
      const res = await fetch("/api/waitlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, name, intent }),
      })
      const data = await res.json()
      if (!res.ok) {
        toast.error(data.error || "Something went wrong.")
        return
      }
      setDone(true)
      toast.success("You're on the waitlist.")
    } catch {
      toast.error("Network error. Please try again.")
    } finally {
      setLoading(false)
    }
  }

  if (done) {
    return (
      <div className="relative min-h-screen overflow-hidden">
        <div className="wf-topo absolute inset-0 -z-10 opacity-70" />
        <div className="absolute inset-0 -z-10 bg-gradient-to-b from-transparent via-background/40 to-background" />
        <div className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-4 py-12 text-center">
          <div className="mb-4 inline-flex h-14 w-14 items-center justify-center rounded-2xl border border-border/60 bg-card/70 wf-panel mx-auto">
            <CheckCircle2 className="h-7 w-7 text-emerald-500" />
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">You're on the waitlist</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Thanks, {name || "friend"}. Wayfinder is in a curated rollout. Our team will review your
            request and create your account — you'll hear from us soon.
          </p>
          <Card className="mt-6 border-border/60 bg-card/60 p-4 text-left">
            <div className="flex items-center gap-2">
              <Clock className="h-4 w-4 text-accent" />
              <span className="text-xs font-medium">What happens next</span>
            </div>
            <ol className="mt-2 space-y-1.5 text-xs text-muted-foreground">
              <li>1. An admin reviews your request.</li>
              <li>2. On approval, an account is created with a temporary password.</li>
              <li>3. You receive credentials by email and can sign in.</li>
            </ol>
          </Card>
          <Button variant="outline" className="mt-6 gap-2" onClick={() => router.push("/login")}>
            Back to sign in
          </Button>
        </div>
      </div>
    )
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
          <h1 className="text-2xl font-semibold tracking-tight">Join the waitlist</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Wayfinder is in a curated rollout. Request access and we'll create your account.
          </p>
        </div>

        <Card className="border-border/60 bg-card/80 p-5 wf-panel">
          <form onSubmit={handleSubmit} className="space-y-3">
            <div>
              <Label htmlFor="email" className="mb-1.5 text-xs font-medium text-muted-foreground">Email *</Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                required
              />
            </div>
            <div>
              <Label htmlFor="name" className="mb-1.5 text-xs font-medium text-muted-foreground">Name</Label>
              <Input
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Your name"
              />
            </div>
            <div>
              <Label htmlFor="intent" className="mb-1.5 text-xs font-medium text-muted-foreground">
                What are you trying to make possible?
              </Label>
              <Textarea
                id="intent"
                value={intent}
                onChange={(e) => setIntent(e.target.value)}
                placeholder="e.g. I want to move to Europe and start a company."
                className="min-h-[80px] resize-none"
              />
            </div>
            <Button type="submit" disabled={loading} className="w-full gap-2">
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
              Request access
            </Button>
          </form>
        </Card>

        <p className="mt-5 text-center text-xs text-muted-foreground">
          Already have an account?{" "}
          <button onClick={() => router.push("/login")} className="font-medium text-primary hover:underline">
            Sign in
          </button>
        </p>
      </div>
    </div>
  )
}
