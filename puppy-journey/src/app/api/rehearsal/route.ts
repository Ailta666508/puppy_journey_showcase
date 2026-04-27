import { NextResponse } from "next/server";

import { generateLessonScript } from "@/lib/pipeline/service";

export const maxDuration = 120;

/**
 * @deprecated 请改用 POST /api/pipeline/script（请求体字段相同）。
 * 保留本路由以免旧客户端报错。
 */
export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const input = {
      userText: typeof body.user_text === "string" ? body.user_text : "",
      imageDescription:
        typeof body.user_image_url === "string"
          ? `图片参考：${body.user_image_url}`
          : typeof body.image_description === "string"
            ? body.image_description
            : "",
      contextAchievements:
        typeof body.context_achievements === "string" ? body.context_achievements : "",
      contextTravel: typeof body.context_travel === "string" ? body.context_travel : "",
      contextWishes: typeof body.context_wishes === "string" ? body.context_wishes : "",
    };
    const script = await generateLessonScript(input);
    return NextResponse.json({
      ok: true,
      deprecated: true,
      hint: "请迁移到 POST /api/pipeline/script，并分步调用 /api/pipeline/image 与 /api/pipeline/video/start",
      result: {
        script,
        parsed_text: "",
        parsed_audio: "",
        parsed_image: "",
        fused_corpus: "",
        script_data: script as unknown as Record<string, unknown>,
        video_url: "",
        vocab_cards: "",
      },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
