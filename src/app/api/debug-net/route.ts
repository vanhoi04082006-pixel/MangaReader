import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const results: any = {};

  // Test 1: Supabase REST API (port 443)
  try {
    const res = await fetch("https://gudvqtzjlcqnctwevnmf.supabase.co/rest/v1/profiles?select=id&limit=1", {
      headers: {
        "apikey": process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || "",
      },
    });
    results.restApi = { status: res.status, ok: res.ok };
  } catch (e: any) {
    results.restApi = { error: e.message?.slice(0, 200) };
  }

  // Test 2: Direct DB connection via Prisma
  try {
    const { PrismaClient } = await import("@prisma/client");
    const prisma = new PrismaClient();
    const r = await prisma.$queryRaw`SELECT 1 as n`;
    results.dbDirect = { ok: true, result: r };
    await prisma.$disconnect();
  } catch (e: any) {
    results.dbDirect = { ok: false, error: e.message?.slice(0, 300) };
  }

  return NextResponse.json(results);
}
