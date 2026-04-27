import { NextResponse } from "next/server";

import { AGENT7_SOS_PROMPT } from "@/lib/rehearsal/prompts";
import { callLlmStandard } from "@/lib/rehearsal/llmServer";

export const maxDuration = 60;

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const sentence = typeof body.sentence === "string" ? body.sentence.trim() : "";
    if (!sentence) {
      return NextResponse.json({ ok: false, error: "请提供 sentence" }, { status: 400 });
    }
    const prompt = `${AGENT7_SOS_PROMPT}\n\n用户卡住的句子：\n${sentence}`;
    const text = await callLlmStandard(prompt);
    return NextResponse.json({ ok: true, text });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
