// POST /api/admin/approve
// Admin creates an account for a waitlisted user and marks them approved.
// Body: { waitlistId, password, role? }
// Returns the new user id. The admin can then share the credentials with the user.

import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { db } from "@/lib/db"
import { createUser } from "@/lib/auth-helpers"
import { z } from "zod"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const Body = z.object({
  waitlistId: z.string(),
  password: z.string().min(8),
  role: z.enum(["USER", "ADMIN", "DEMO"]).optional().default("USER"),
})

export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session || (session.user as any)?.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  try {
    const json = await req.json()
    const parsed = Body.safeParse(json)
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid request" }, { status: 400 })
    }

    const entry = await db.waitlistEntry.findUnique({ where: { id: parsed.data.waitlistId } })
    if (!entry) {
      return NextResponse.json({ error: "Waitlist entry not found" }, { status: 404 })
    }
    if (entry.status === "APPROVED") {
      return NextResponse.json({ error: "Already approved" }, { status: 409 })
    }

    const user = await createUser({
      email: entry.email,
      password: parsed.data.password,
      name: entry.name ?? undefined,
      role: parsed.data.role,
    })

    await db.waitlistEntry.update({
      where: { id: entry.id },
      data: { status: "APPROVED", userId: user.id },
    })

    return NextResponse.json({ ok: true, userId: user.id, email: user.email })
  } catch (err) {
    console.error("[/api/admin/approve]", err)
    return NextResponse.json({ error: "Failed to approve" }, { status: 500 })
  }
}

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session || (session.user as any)?.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }
  const entries = await db.waitlistEntry.findMany({ orderBy: { createdAt: "desc" }, take: 200 })
  return NextResponse.json({ entries })
}
