// Wayfinder — route protection middleware.
//
// P4.0: Accepts BOTH authentication mechanisms:
//   - Web: NextAuth session cookie
//   - Mobile: Authorization: Bearer <mobile JWT>
//
// Both resolve to the same AuthenticatedPrincipal, so downstream
// authorization logic is shared.
//
// Public: /login, /signup, /api/auth/*, /api/waitlist, /api/health,
//         /api/mobile/contract, static assets.
// Protected (any authenticated user): everything else.
// Protected (ADMIN role): /admin and /api/admin/*.

import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"
import { resolveAuthenticatedPrincipal } from "@/lib/mobile-contract/principal"

const PUBLIC_PATHS = [
  "/login",
  "/signup",
  "/api/auth",
  "/api/waitlist",
  "/api/health",
  "/api/cron",
  "/api/mobile/contract", // P4.0: public OpenAPI spec for mobile clients
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

  // P4.0: Resolve principal from EITHER web session OR mobile Bearer token.
  const principal = await resolveAuthenticatedPrincipal(req)

  if (!principal.authenticated) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }
    const url = new URL("/login", req.url)
    url.searchParams.set("callbackUrl", pathname)
    return NextResponse.redirect(url)
  }

  if (pathname.startsWith("/admin") || pathname.startsWith("/api/admin")) {
    if (principal.role !== "ADMIN") {
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
