import { NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Vercel Cronで毎日1回叩いてSupabaseをPause防止する
export async function GET(req: NextRequest) {
  // Vercel Cron経由かどうかをヘッダで識別(なつこさん操作不要)
  // 外部から叩かれてもDBに無害なcountを1回投げるだけなので公開でOK
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    return new Response("supabase not configured", { status: 500 });
  }

  const sb = createClient(url, serviceKey, { auth: { persistSession: false } });
  const { error, count } = await sb
    .from("sessions")
    .select("*", { count: "exact", head: true });

  if (error) return new Response(`db error: ${error.message}`, { status: 500 });

  return Response.json({ ok: true, at: new Date().toISOString(), sessions: count ?? 0 });
}
