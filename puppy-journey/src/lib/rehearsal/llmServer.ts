/**
 * Next.js 服务端 OpenAI 兼容调用层（与 `rehearsal_backend/ai_wrapper.py` 使用相同环境变量）。
 * 与 `src/lib/pipeline/config` 共用运行时配置（含 PIPELINE_SCRIPT_LLM_ENDPOINT_ID、方舟默认 BASE_URL）。
 */

import { getScriptLlmRuntimeConfig } from "@/lib/pipeline/config";

export function getLlmConfig() {
  return getScriptLlmRuntimeConfig();
}

export function assertLlmConfigured() {
  const { apiKey } = getLlmConfig();
  if (!apiKey || apiKey === "your_api_key_here") {
    throw new Error(
      "未配置有效的 PIPELINE_SCRIPT_LLM_API_KEY（或兼容项 VITE_LLM_API_KEY）。请在 puppy-journey/.env.local 中设置。",
    );
  }
}

type ChatMessage = { role: "user" | "system" | "assistant"; content: string };

async function chatCompletion(messages: ChatMessage[], jsonMode: boolean): Promise<string> {
  assertLlmConfigured();
  const { apiKey, baseUrl, model } = getLlmConfig();
  const body: Record<string, unknown> = {
    model,
    messages,
  };
  if (jsonMode) {
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
    throw new Error(`LLM 请求失败 ${res.status}: ${rawText.slice(0, 800)}`);
  }
  let data: { choices?: { message?: { content?: unknown } }[] };
  try {
    data = JSON.parse(rawText) as typeof data;
  } catch {
    throw new Error("LLM 响应非 JSON");
  }
  const content = data.choices?.[0]?.message?.content;
  if (typeof content === "string") return content;
  if (content == null) return "";
  return String(content);
}

export async function callLlmStandard(prompt: string): Promise<string> {
  return chatCompletion([{ role: "user", content: prompt }], false);
}

export async function callLlmJson(prompt: string): Promise<Record<string, unknown>> {
  const text = (await chatCompletion([{ role: "user", content: prompt }], true)).trim();
  try {
    const parsed = JSON.parse(text) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    throw new TypeError("期望 JSON 对象");
  } catch (e) {
    const err = e instanceof Error ? e : new Error(String(e));
    throw new Error(`LLM JSON 解析失败: ${err.message}\n---\n${text.slice(0, 1500)}`);
  }
}
