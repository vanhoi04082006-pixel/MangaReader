// GET /api/health — PUBLIC health check (co ban, khong lo thong tin)
// Chi tra ve trang thai song cua ung dung. Thong tin chi tiet (DB, R2,
// cau hinh) nam o /api/health/ready (yeu cau admin).
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json(
    { status: "ok", time: new Date().toISOString() },
    { status: 200, headers: { "Cache-Control": "no-store" } }
  );
}
