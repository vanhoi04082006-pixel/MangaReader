// =============================================================
// Profile service: dam bao profile ton tai cho user da xac thuc
// =============================================================

import { supabase } from "@/lib/supabase";

export async function ensureProfile(user: { id: string; email: string }) {
  // Upsert: neu da ton tai thi update email, neu chua thi tao moi
  const { data, error } = await supabase
    .from("profiles")
    .upsert({ id: user.id, email: user.email }, { onConflict: "id" })
    .select()
    .single();
  if (error) throw new Error(`ensureProfile failed: ${error.message}`);
  return data;
}

export async function getProfile(userId: string) {
  const { data, error } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", userId)
    .maybeSingle();
  if (error) throw new Error(`getProfile failed: ${error.message}`);
  return data;
}