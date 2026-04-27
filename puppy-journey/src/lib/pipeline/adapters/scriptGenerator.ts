import { chatCompletionJson, chatCompletionJsonWithImage } from "@/lib/pipeline/openaiCompatibleChat";
import { buildMergedScriptUserPrompt, MERGED_SCRIPT_SYSTEM } from "@/lib/pipeline/prompts";
import type { LessonScript } from "@/lib/pipeline/types";

function stripMarkdownJsonFence(text: string): string {
  const t = text.trim();
  const m = t.match(/^```(?:json)?\s*([\s\S]*?)```\s*$/i);
  if (m?.[1]) return m[1].trim();
  return t;
}

function lineText(o: Record<string, unknown>): string {
  if (typeof o.text === "string" && o.text.trim()) return o.text;
  if (typeof o.spanish === "string" && o.spanish.trim()) return o.spanish;
  return "";
}

function lineTranslation(o: Record<string, unknown>): string | undefined {
  if (typeof o.translation === "string" && o.translation.trim()) return o.translation;
  if (typeof o.chinese === "string" && o.chinese.trim()) return o.chinese;
  return undefined;
}

function isScriptLine(x: unknown): boolean {
  if (!x || typeof x !== "object" || Array.isArray(x)) return false;
  const o = x as Record<string, unknown>;
  const timeOk = (v: unknown) => typeof v === "number" || (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)));
  const hasText = lineText(o).length > 0;
  return (
    (o.type === "npc" || o.type === "player") &&
    typeof o.character === "string" &&
    hasText &&
    timeOk(o.startTime) &&
    timeOk(o.endTime)
  );
}

function coerceScriptLine(o: Record<string, unknown>, index: number): LessonScript["script"][number] {
  const id =
    typeof o.id === "number"
      ? o.id
      : typeof o.id === "string" && o.id.trim() !== ""
        ? Number(o.id)
        : index + 1;
  const startTime = typeof o.startTime === "number" ? o.startTime : Number(o.startTime);
  const endTime = typeof o.endTime === "number" ? o.endTime : Number(o.endTime);
  return {
    id,
    type: o.type as "npc" | "player",
    character: String(o.character),
    text: lineText(o),
    translation: lineTranslation(o),
    startTime,
    endTime,
  };
}

/** 与下游 Seedance 成片时长一致；模型若把时间轴压太短则按比例拉满，便于视频侧按慢节奏对齐 */
const TARGET_SCRIPT_TIMELINE_SEC = 8;

function stretchScriptTimelineToTarget(
  script: LessonScript["script"],
  targetEndSec: number,
): LessonScript["script"] {
  if (script.length === 0) return script;
  const maxT = Math.max(...script.map((l) => l.endTime), 0);
  if (!(maxT > 0) || maxT >= targetEndSec * 0.92) return script;
  const scale = targetEndSec / maxT;
  const r1 = (n: number) => Math.round(n * 10) / 10;
  return script.map((l) => ({
    ...l,
    startTime: r1(l.startTime * scale),
    endTime: r1(l.endTime * scale),
  }));
}

function normalizeScript(raw: Record<string, unknown>): LessonScript {
  const scene = String(raw.scene ?? "").trim() || "通用西语场景";
  const theme = String(raw.theme ?? "").trim() || "初级对话";
  const levelRaw = String(raw.level ?? "beginner").toLowerCase();
  const level =
    levelRaw === "intermediate" || levelRaw === "advanced" ? levelRaw : "beginner";
  const arr = raw.script;
  const scriptRaw =
    Array.isArray(arr) && arr.every(isScriptLine)
      ? (arr as Record<string, unknown>[]).map((row, i) => coerceScriptLine(row, i))
      : [];
  if (scriptRaw.length === 0) {
    throw new Error("剧本 JSON 缺少有效 script 数组（需含西语台词与中文翻译字段）");
  }
  const script = stretchScriptTimelineToTarget(scriptRaw, TARGET_SCRIPT_TIMELINE_SEC);
  const visualPromptHint =
    typeof raw.visualPromptHint === "string" ? raw.visualPromptHint.trim() : undefined;
  return { scene, theme, level, script, visualPromptHint };
}

export type GenerateScriptInput = {
  userText?: string;
  imageDescription?: string;
  /** data:image/...;base64,... 或 https 图片 URL（走 Chat Completions 多模态） */
  userImageDataUrl?: string;
  contextAchievements?: string;
  contextTravel?: string;
  contextWishes?: string;
};

/**
 * 统一入口：生成结构化剧本（原 Agent 1–4 合并）。
 */
export async function generateScript(input: GenerateScriptInput): Promise<LessonScript> {
  const user = buildMergedScriptUserPrompt({
    userText: input.userText ?? "",
    imageDescription: input.imageDescription ?? "",
    contextAchievements: input.contextAchievements ?? "",
    contextTravel: input.contextTravel ?? "",
    contextWishes: input.contextWishes ?? "",
  });

  const text = (
    input.userImageDataUrl?.trim()
      ? await chatCompletionJsonWithImage(MERGED_SCRIPT_SYSTEM, user, input.userImageDataUrl.trim())
      : await chatCompletionJson([
          { role: "system", content: MERGED_SCRIPT_SYSTEM },
          { role: "user", content: user },
        ])
  ).trim();
  const fenced = stripMarkdownJsonFence(text);
  let parsed: unknown;
  try {
    parsed = JSON.parse(fenced) as unknown;
  } catch {
    throw new Error(`剧本 JSON 解析失败: ${fenced.slice(0, 600)}`);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("剧本 LLM 未返回 JSON 对象");
  }
  return normalizeScript(parsed as Record<string, unknown>);
}
