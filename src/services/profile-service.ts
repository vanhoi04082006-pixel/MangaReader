// =============================================================
// Profile service: dam bao profile ton tai cho user da xac thuc
// =============================================================

import { db } from "@/lib/db";

export async function ensureProfile(user: { id: string; email: string }) {
  return db.profile.upsert({
    where: { id: user.id },
    update: { email: user.email },
    create: { id: user.id, email: user.email },
  });
}

export async function getProfile(userId: string) {
  return db.profile.findUnique({ where: { id: userId } });
}
