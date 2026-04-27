import { assertScriptLlmConfigured, getScriptLlmRuntimeConfig } from "@/lib/pipeline/config";

type TextPart = { type: "text"; text: string };
type ImagePart = { type: "image_url"; image_url: { url: string } };
type UserContentPart = TextPart | ImagePart;

type ChatMessageForApi =
  | { role: "system"; content: string }
  | { role: "user"; content: string | UserContentPart[] };

function extractTextContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (content == null) return "";
  return String(content);
}

async function postChatCompletion(messages: ChatMessageForApi[], options?: { jsonObjectMode?: boolean }) {
  assertScriptLlmConfigured();
  const { apiKey, baseUrl, model } = getScriptLlmRuntimeConfig();
  const wantJson = options?.jsonObjectMode !== false;
  /** 火山方舟部分接入点不支持 OpenAI 的 response_format=json_object */
  const supportsJsonObject = wantJson && !baseUrl.includes("volces.com");
  const body: Record<string, unknown> = { model, messages };
  if (supportsJsonObject) {
    body.response_format = { type: "json_object" };
  }
  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });
  const rawText = await res.text();
  if (!res.ok) {
    throw new Error(`剧本 LLM 请求失败 ${res.status}: ${rawText.slice(0, 800)}`);
  }
  let data: { choices?: { message?: { content?: unknown } }[] };
  try {
    data = JSON.parse(rawText) as typeof data;
  } catch {
    throw new Error("剧本 LLM 响应非 JSON");
  }
  return extractTextContent(data.choices?.[0]?.message?.content);
}

/** 纯文本用户消息 */
export async function chatCompletionJson(messages: { role: "system" | "user"; content: string }[]): Promise<string> {
  return postChatCompletion(messages, { jsonObjectMode: true });
}

/**
 * 多模态 JSON 输出（需方舟/模型支持 vision；接入方式与 OpenAI Chat Completions 一致）。
 */
export async function chatCompletionJsonWithImage(
  systemPrompt: string,
  userTextBlock: string,
  userImageDataUrl: string,
): Promise<string> {
  const trimmed = userImageDataUrl.trim();
  if (!trimmed.startsWith("data:") && !trimmed.startsWith("http")) {
    throw new Error("user_image_data_url 须为 data URL 或 https 图片地址");
  }
  return postChatCompletion(
    [
      { role: "system", content: systemPrompt },
      {
        role: "user",
        content: [
          { type: "text", text: `${userTextBlock}\n\n（以下为同一用户上传的参考图，请结合理解。）` },
          { type: "image_url", image_url: { url: trimmed } },
        ],
      },
    ],
    { jsonObjectMode: true },
  );
}
