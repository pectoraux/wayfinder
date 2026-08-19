// Wayfinder — seed script.
//
// Creates the real admin + demo accounts on the Neon database. Idempotent.
// Run with: bun run seed

import { db } from "../src/lib/db"
import { hashPassword } from "../src/lib/auth-helpers"

async function upsertUser(email: string, password: string, name: string, role: "USER" | "ADMIN" | "DEMO") {
  const existing = await db.user.findUnique({ where: { email } })
  if (existing) {
    return db.user.update({
      where: { email },
      data: { passwordHash: await hashPassword(password), role, name },
    })
  }
  return db.user.create({
    data: { email, name, role, passwordHash: await hashPassword(password) },
  })
}

async function main() {
  console.log("Seeding Wayfinder accounts on Neon…")

  // Real (non-demo) admin — the one who approves the waitlist.
  await upsertUser("ekontetevi@gmail.com", "Payswap123456", "Admin", "ADMIN")
  console.log("  ✓ Admin: ekontetevi@gmail.com / Payswap123456")

  // Demo accounts with quick-login links.
  await upsertUser("demo-user@wayfinder.app", "wayfinder", "Demo User (Kenya SWE)", "DEMO")
  console.log("  ✓ Demo user: demo-user@wayfinder.app / wayfinder")

  await upsertUser("demo-admin@wayfinder.app", "wayfinder", "Demo Admin", "ADMIN")
  console.log("  ✓ Demo admin: demo-admin@wayfinder.app / wayfinder")

  console.log("\nDone. All accounts are ready.")
}

main()
  .catch((e) => {
    console.error("Seed failed:", e)
    process.exit(1)
  })
  .finally(async () => {
    await db.$disconnect()
  })
