import { NextRequest } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TITLE_PROMPT = `あなたは対話のアーカイブ司書です。
ユーザーとAIコーチのやり取りから、後で本人が見返したときに「あ、これだ」と思い出せるような、短くやわらかい日本語のタイトルを1つだけ作ってください。

ルール:
- 12〜18文字程度
- 体言止め、または「〜について」で終える
- 過度に詩的にせず、相談の中心テーマが分かる言葉を使う
- 鍵かっこ・引用符・記号・絵文字は使わない
- タイトルだけを1行で出力（前置き・説明・改行は一切なし）`;

const MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";

export async function POST(req: NextRequest) {
  const accountId = process.env.CF_ACCOUNT_ID;
  const apiToken = process.env.CF_API_TOKEN;
  if (!accountId || !apiToken) {
    return Response.json({ title: "" });
  }

  const { messages } = (await req.json()) as {
    messages: { role: "user" | "assistant"; content: string }[];
  };
  if (!Array.isArray(messages) || messages.length === 0) {
    return new Response("invalid messages", { status: 400 });
  }

  const transcript = messages
    .slice(0, 12)
    .map((m) => `${m.role === "user" ? "ユーザー" : "コーチ"}: ${m.content}`)
    .join("\n")
    .slice(0, 4000);

  const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${MODEL}`;

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: [
          { role: "system", content: TITLE_PROMPT },
          { role: "user", content: transcript },
        ],
        max_tokens: 64,
      }),
    });
    if (!res.ok) return Response.json({ title: "" });
    const j = await res.json().catch(() => null);
    const text: string | undefined = j?.result?.choices?.[0]?.message?.content ?? j?.result?.response;
    if (text) {
      const title = String(text).trim().split("\n")[0].replace(/^[「『"']|[」』"']$/g, "").slice(0, 30);
      return Response.json({ title });
    }
  } catch {}

  return Response.json({ title: "" });
}
