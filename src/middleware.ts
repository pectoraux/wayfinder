// Wayfinder — route protection middleware.
//
// Public: /login, /signup, /api/auth/*, /api/waitlist, static assets.
// Protected (any authenticated user): everything else, including / and /api/*.
// Protected (ADMIN role): /admin and /api/admin/*.

import { NextResponse } from "next/server"
import { getToken } from "next-auth/jwt"
import type { NextRequest } from "next/server"

const PUBLIC_PATHS = [
  "/login",
  "/signup",
  "/api/auth",
  "/api/waitlist",
  "/api/health",
  "/api/cron",
  "/api/policy/events", // public policy event feed + detail
  "/policy/events", // public policy event pages
  "/_next",
  "/favicon.ico",
  "/robots.txt",
  "/logo.svg",
]

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl

  if (PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p + "/"))) {
    return NextResponse.next()
  }

  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET })

  if (!token) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }
    const url = new URL("/login", req.url)
    url.searchParams.set("callbackUrl", pathname)
    return NextResponse.redirect(url)
  }

  if (pathname.startsWith("/admin") || pathname.startsWith("/api/admin")) {
    if (token.role !== "ADMIN") {
      if (pathname.startsWith("/api/")) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 })
      }
      return NextResponse.redirect(new URL("/", req.url))
    }
  }

  return NextResponse.next()
}

export const config = {
  // Run on everything except Next.js internals and static asset extensions.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|robots.txt|logo.svg|.*\\..*).*)"],
}
