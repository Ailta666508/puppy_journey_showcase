import { NextResponse } from "next/server";

import { getScriptLlmRuntimeConfig, getVideoHttpRuntimeConfig } from "@/lib/pipeline/config";
import { getQAvatarVolcengineCredentials } from "@/lib/qAvatarVolcengineConfig";

/**
 * 不返回任何密钥；用于确认 .env.local 已写入磁盘并被进程加载。
 */
export async function GET() {
  const script = getScriptLlmRuntimeConfig();
  const volc = getQAvatarVolcengineCredentials();
  const video = getVideoHttpRuntimeConfig();
  return NextResponse.json({
    ok: true,
    scriptLlm: {
      apiKeyPresent: Boolean(script.apiKey),
      baseUrl: script.baseUrl,
      modelIsEndpoint: script.model.startsWith("ep-"),
    },
    volcImage: {
      configured: Boolean(volc),
    },
    video: {
      provider: video.provider,
      apiKeyPresent: Boolean(video.apiKey),
      baseUrl: video.baseUrl || null,
      model: video.model,
    },
    hint: "若 scriptLlm.apiKeyPresent 为 false：在编辑器中保存 puppy-journey/.env.local（Ctrl+S），并重启 pnpm dev。已配置视频 Key 时 video.provider 应为 http；仅无凭证或设置 PIPELINE_VIDEO_FORCE_MOCK=1 且 PROVIDER=mock 时为 mock。",
  });
}
