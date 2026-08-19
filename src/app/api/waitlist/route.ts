// POST /api/waitlist
// Adds an email to the waitlist. Does NOT create a User account — the admin
// approves and creates accounts from /admin. Returns 409 if the email is
// already on the waitlist or already has an account.

import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { z } from "zod"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const Body = z.object({
  email: z.string().email(),
  name: z.string().optional(),
  intent: z.string().optional(),
})

export async function POST(req: Request) {
  try {
    const json = await req.json()
    const parsed = Body.safeParse(json)
    if (!parsed.success) {
      return NextResponse.json({ error: "Valid email is required" }, { status: 400 })
    }
    const email = parsed.data.email.trim().toLowerCase()

    // Already a user?
    const existingUser = await db.user.findUnique({ where: { email } })
    if (existingUser) {
      return NextResponse.json(
        { error: "An account with this email already exists. Please log in." },
        { status: 409 },
      )
    }

    // Already waitlisted?
    const existing = await db.waitlistEntry.findUnique({ where: { email } })
    if (existing) {
      return NextResponse.json(
        { error: "You're already on the waitlist. We'll be in touch.", status: existing.status },
        { status: 409 },
      )
    }

    await db.waitlistEntry.create({
      data: { email, name: parsed.data.name, intent: parsed.data.intent },
    })

    return NextResponse.json({ ok: true, message: "Added to the waitlist." })
  } catch (err) {
    console.error("[/api/waitlist]", err)
    return NextResponse.json({ error: "Failed to join waitlist" }, { status: 500 })
  }
}
