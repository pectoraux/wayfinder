"use client"

import { useSession, signOut } from "next-auth/react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { LogOut, Shield, User as UserIcon, GitBranch } from "lucide-react"
import { cn } from "@/lib/utils"

export function HeaderAuth() {
  const { data: session } = useSession()
  const router = useRouter()

  if (!session?.user) {
    return (
      <Button variant="outline" size="sm" onClick={() => router.push("/login")} className="h-7 gap-1.5 text-xs">
        <UserIcon className="h-3 w-3" /> Sign in
      </Button>
    )
  }

  const role = (session.user as any).role as string | undefined
  const isAdmin = role === "ADMIN"
  const isDemo = role === "DEMO"

  return (
    <div className="flex items-center gap-2">
      <div className="hidden items-center gap-1.5 sm:flex">
        <Button variant="ghost" size="sm" onClick={() => router.push("/policy")} className="h-7 gap-1.5 text-xs">
          <GitBranch className="h-3 w-3" /> Policy
        </Button>
        {isAdmin && (
          <Button variant="ghost" size="sm" onClick={() => router.push("/admin/policy")} className="h-7 gap-1.5 text-xs">
            <GitBranch className="h-3 w-3" /> Policy Console
          </Button>
        )}
        {isAdmin && (
          <Button variant="ghost" size="sm" onClick={() => router.push("/admin")} className="h-7 gap-1.5 text-xs">
            <Shield className="h-3 w-3" /> Admin
          </Button>
        )}
        <Badge
          variant="outline"
          className={cn(
            "text-[10px] font-normal capitalize",
            isDemo && "border-accent/40 text-accent-foreground",
          )}
        >
          {role?.toLowerCase() ?? "user"}
        </Badge>
      </div>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => signOut({ callbackUrl: "/login" })}
        className="h-7 gap-1.5 text-xs"
        title={session.user.email ?? "Sign out"}
      >
        <LogOut className="h-3 w-3" />
        <span className="hidden sm:inline">Sign out</span>
      </Button>
    </div>
  )
}
