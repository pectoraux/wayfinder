// Wayfinder — password hashing + user creation helpers.

import bcrypt from "bcryptjs"
import { db } from "@/lib/db"
import type { Role } from "@prisma/client"

const SALT_ROUNDS = 10

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, SALT_ROUNDS)
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash)
}

export interface CreateUserInput {
  email: string
  password: string
  name?: string
  role?: Role
}

export async function createUser(input: CreateUserInput) {
  const passwordHash = await hashPassword(input.password)
  return db.user.create({
    data: {
      email: input.email.trim().toLowerCase(),
      passwordHash,
      name: input.name,
      role: input.role ?? "USER",
    },
  })
}
