import { NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 毎日1回GitHub Actionsから叩かれる。会員より先に壊れたことに気づくための監視用。
export async function GET(_req: NextRequest) {
  const checks: Record<string, string> = {};

  const supaUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supaUrl || !serviceKey) {
    checks.supabase = "env not configured";
  } else {
    const sb = createClient(supaUrl, serviceKey, { auth: { persistSession: false } });
    const { error } = await sb.from("sessions").select("id", { count: "exact", head: true });
    checks.supabase = error ? `error: ${error.message}` : "ok";
  }

  const accountId = process.env.CF_ACCOUNT_ID;
  const apiToken = process.env.CF_API_TOKEN;
  if (!accountId || !apiToken) {
    checks.ai = "env not configured";
  } else {
    try {
      const res = await fetch(
        `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/@cf/meta/llama-3.3-70b-instruct-fp8-fast`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${apiToken}`, "Content-Type": "application/json" },
          body: JSON.stringify({ messages: [{ role: "user", content: "ping" }], max_tokens: 5 }),
        },
      );
      if (!res.ok) {
        const t = await res.text().catch(() => "");
        checks.ai = `error ${res.status}: ${t.slice(0, 200)}`;
      } else {
        checks.ai = "ok";
      }
    } catch (e: any) {
      checks.ai = `unreachable: ${e?.message ?? e}`;
    }
  }

  const ok = Object.values(checks).every((v) => v === "ok");
  return Response.json({ ok, checks, at: new Date().toISOString() }, { status: ok ? 200 : 500 });
}
