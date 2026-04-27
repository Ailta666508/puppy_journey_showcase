import { NextResponse } from "next/server";

export async function POST(req: Request) {
  // 占位：后续接入本地模型（Ollama）+ LangChain/LangGraph 多智能体编排
  const body = await req.json().catch(() => ({}));
  return NextResponse.json({
    ok: true,
    message: "agent route placeholder",
    echo: body,
  });
}

