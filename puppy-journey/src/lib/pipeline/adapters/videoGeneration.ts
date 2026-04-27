import {
  ARK_VIDEO_CREATE_TASK_PATH,
  ARK_VIDEO_GET_TASK_PATH_TEMPLATE,
  getVideoHttpRuntimeConfig,
} from "@/lib/pipeline/config";
import {
  AGENT3_IMAGE_TO_VIDEO_SOURCE_LOCK,
  AGENT3_TEXT_TO_VIDEO_SCRIPT_LOCK,
  AGENT3_VIDEO_TASK_COMMON,
} from "@/lib/pipeline/prompts";
import type { PipelineVideoJobResult, StartVideoInput } from "@/lib/pipeline/types";

const MOCK_READY_MS = 4_000;

type JobToken =
  | { kind: "mock"; startedAt: number; slug: string }
  | { kind: "http"; taskId: string };

function encodeToken(t: JobToken): string {
  return Buffer.from(JSON.stringify(t), "utf8").toString("base64url");
}

function decodeToken(id: string): JobToken | null {
  try {
    const raw = Buffer.from(id, "base64url").toString("utf8");
    const o = JSON.parse(raw) as JobToken;
    if (o.kind === "mock" && typeof o.startedAt === "number" && typeof o.slug === "string") return o;
    if (o.kind === "http" && typeof o.taskId === "string" && o.taskId) return o;
  } catch {
    /* ignore */
  }
  return null;
}

function mockVideoUrlFromSlug(slug: string): string {
  void slug;
  return "https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.webm";
}

/** 方舟 Seedance 文本参数：与官方示例一致，附加在 prompt 末尾 */
const SEEDANCE_CLI_SUFFIX = " --duration 8 --camerafixed false --watermark true";

function buildArkVideoTextPrompt(input: StartVideoInput, textToVideo: boolean): string {
  const { scene, theme, script, visualPromptHint } = input.script;
  const dialogue = script
    .slice(0, 20)
    .map((l) => `${l.character}：${l.text}${l.translation ? `（${l.translation}）` : ""}`)
    .join("\n");
  const hintBlock = visualPromptHint?.trim()
    ? `【Agent 1 · visualPromptHint（与生图/首帧一致的画面补充，须与视频一致）】\n${visualPromptHint.trim()}`
    : "";
  const tail = textToVideo
    ? `文生视频执行：无首帧图，严格按上方 Agent 1 字段生成；保持粗描边卡通双狗与教育场景，口型与节奏偏慢；${SEEDANCE_CLI_SUFFIX.trim()}`
    : `图生视频执行：以上传的首帧图为时间轴第 0 秒画面（即 Agent 2 关键帧），从该帧连贯演变；口型与氛围贴合对白，且全程遵守「来源与一致性」中对双狗卡通人设的锁；${SEEDANCE_CLI_SUFFIX.trim()}`;
  const scriptCore = [
    "【Agent 1 · 结构化剧本 JSON（scene / theme / 对白）】",
    `scene：${scene}`,
    `theme：${theme}`,
    ...(hintBlock ? [hintBlock] : []),
    "",
    "【对白与角色时间线（须与成片一致）】",
    dialogue || "（无）",
  ].join("\n");

  if (textToVideo) {
    return [
      AGENT3_VIDEO_TASK_COMMON,
      "",
      AGENT3_TEXT_TO_VIDEO_SCRIPT_LOCK,
      "",
      scriptCore,
      "",
      tail,
    ].join("\n");
  }

  return [
    AGENT3_VIDEO_TASK_COMMON,
    "",
    AGENT3_IMAGE_TO_VIDEO_SOURCE_LOCK,
    "",
    scriptCore,
    "",
    tail,
  ].join("\n");
}

function parseTaskIdFromCreateResponse(raw: unknown): string | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const o = raw as Record<string, unknown>;
  if (typeof o.id === "string" && o.id) return o.id;
  if (typeof o.task_id === "string" && o.task_id) return o.task_id;
  const d = o.data;
  if (d && typeof d === "object") {
    const id = (d as Record<string, unknown>).id;
    if (typeof id === "string" && id) return id;
  }
  return undefined;
}

function extractTaskStatus(data: Record<string, unknown>): string {
  const pick = (v: unknown): string =>
    typeof v === "string" && v.trim() ? v.trim().toLowerCase() : "";
  const direct = pick(data.status ?? data.task_status ?? data.state ?? data.phase);
  if (direct) return direct;
  const task = data.task;
  if (task && typeof task === "object") {
    const t = pick((task as Record<string, unknown>).status);
    if (t) return t;
  }
  const output = data.output;
  if (output && typeof output === "object") {
    const t = pick((output as Record<string, unknown>).status);
    if (t) return t;
  }
  return "";
}

const SUCCESS_STATUSES = new Set([
  "succeeded",
  "success",
  "successful",
  "completed",
  "complete",
  "done",
  "finished",
]);

const FAILED_STATUSES = new Set([
  "failed",
  "error",
  "cancelled",
  "canceled",
  "fail",
  "timeout",
  "expired",
]);

/** 方舟返回结构多变时，在 JSON 里深搜首个疑似视频地址 */
function findHttpsVideoUrlDeep(root: unknown, maxDepth = 14): string | undefined {
  const candidates: string[] = [];
  const walk = (v: unknown, depth: number) => {
    if (depth > maxDepth) return;
    if (typeof v === "string" && v.startsWith("https://")) {
      candidates.push(v);
      return;
    }
    if (!v || typeof v !== "object") return;
    if (Array.isArray(v)) {
      for (const x of v) walk(x, depth + 1);
      return;
    }
    for (const x of Object.values(v)) walk(x, depth + 1);
  };
  walk(root, 0);
  const videoish = (u: string) =>
    /\.(mp4|webm|mov|m4v)(\?|$)/i.test(u) ||
    /\/video\//i.test(u) ||
    /tos.*volces|volces\.com.*(video|media)|seedance/i.test(u);
  return candidates.find(videoish) ?? candidates[0];
}

function tryHttpUrl(v: unknown): string | undefined {
  return typeof v === "string" && (v.startsWith("http://") || v.startsWith("https://")) ? v : undefined;
}

/** 从方舟「查询任务」多种可能结构里取出视频地址 */
function extractVideoUrlFromTaskPayload(data: Record<string, unknown>): string | undefined {
  const direct =
    tryHttpUrl(data.video_url) ?? tryHttpUrl(data.url) ?? tryHttpUrl(data.file_url) ?? tryHttpUrl(data.media_url);
  if (direct) return direct;

  const output = data.output;
  if (output && typeof output === "object") {
    const o = output as Record<string, unknown>;
    const u = tryHttpUrl(o.video_url) ?? tryHttpUrl(o.url);
    if (u) return u;
  }

  const result = data.result;
  if (result && typeof result === "object") {
    const r = result as Record<string, unknown>;
    const u = tryHttpUrl(r.video_url) ?? tryHttpUrl(r.url);
    if (u) return u;
  }

  const content = data.content;
  if (Array.isArray(content)) {
    for (const block of content) {
      if (!block || typeof block !== "object") continue;
      const b = block as Record<string, unknown>;
      const vu = b.video_url;
      if (vu && typeof vu === "object" && "url" in vu) {
        const url = (vu as { url?: string }).url;
        const u = tryHttpUrl(url);
        if (u) return u;
      }
      const u2 = tryHttpUrl(b.url);
      if (u2) return u2;
    }
  }

  return undefined;
}

function extractErrorMessage(data: Record<string, unknown>): string | undefined {
  const e = data.error;
  if (typeof e === "string") return e;
  if (e && typeof e === "object" && "message" in e) {
    const m = (e as { message?: unknown }).message;
    if (typeof m === "string") return m;
  }
  return undefined;
}

/**
 * 启动视频任务（快速返回 jobId，供前端轮询）。Agent 3。
 */
export async function startVideoGeneration(input: StartVideoInput): Promise<{ jobId: string }> {
  const { provider, apiKey, baseUrl } = getVideoHttpRuntimeConfig();
  const slug = input.script.scene.replace(/\s+/g, "-").slice(0, 40);

  if (provider === "http") {
    if (!apiKey || !baseUrl) {
      throw new Error(
        "视频为 http 模式时需配置 PIPELINE_VIDEO_API_KEY、ARK_API_KEY 或 VOLCENGINE_Q_AVATAR_API_KEY 之一，且 BASE_URL 可解析（ep- 或默认方舟）",
      );
    }
    const taskId = await submitArkVideoGenerationTask(input);
    return { jobId: encodeToken({ kind: "http", taskId }) };
  }

  return { jobId: encodeToken({ kind: "mock", startedAt: Date.now(), slug }) };
}

/**
 * 轮询任务状态（mock 用时间戳；方舟走 GET contents/generations/tasks/:id）
 */
export async function getVideoJobStatus(jobId: string): Promise<PipelineVideoJobResult> {
  const token = decodeToken(jobId);
  if (!token) {
    return { status: "failed", error: "无效 jobId" };
  }

  if (token.kind === "mock") {
    const elapsed = Date.now() - token.startedAt;
    if (elapsed < MOCK_READY_MS) {
      return { status: "processing", providerTaskId: "mock" };
    }
    return {
      status: "completed",
      videoUrl: mockVideoUrlFromSlug(token.slug),
      providerTaskId: "mock",
    };
  }

  return pollArkVideoGenerationTask(token.taskId);
}

async function submitArkVideoGenerationTask(input: StartVideoInput): Promise<string> {
  const { apiKey, baseUrl, model } = getVideoHttpRuntimeConfig();
  const url = `${baseUrl}${ARK_VIDEO_CREATE_TASK_PATH}`;
  const frame = typeof input.firstFrameImageUrl === "string" ? input.firstFrameImageUrl.trim() : "";
  const textToVideo = !frame;
  const text = buildArkVideoTextPrompt(input, textToVideo);
  const content: Array<{ type: string; text?: string; image_url?: { url: string } }> = [{ type: "text", text }];
  if (frame) {
    content.push({ type: "image_url", image_url: { url: frame } });
  }
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      content,
    }),
  });
  const rawText = await res.text();
  if (!res.ok) {
    throw new Error(`方舟图生视频创建失败 ${res.status}: ${rawText.slice(0, 800)}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText) as unknown;
  } catch {
    throw new Error("方舟图生视频创建响应非 JSON");
  }
  const taskId = parseTaskIdFromCreateResponse(parsed);
  if (!taskId) {
    throw new Error(`方舟图生视频创建响应缺少任务 id：${rawText.slice(0, 400)}`);
  }
  return taskId;
}

async function pollArkVideoGenerationTask(taskId: string): Promise<PipelineVideoJobResult> {
  const { apiKey, baseUrl } = getVideoHttpRuntimeConfig();
  const path = ARK_VIDEO_GET_TASK_PATH_TEMPLATE.replace("{id}", encodeURIComponent(taskId));
  const url = `${baseUrl}${path}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  const rawText = await res.text();
  if (!res.ok) {
    return {
      status: "failed",
      error: `查询视频任务失败 ${res.status}: ${rawText.slice(0, 400)}`,
      providerTaskId: taskId,
    };
  }
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(rawText) as Record<string, unknown>;
  } catch {
    return { status: "failed", error: "查询任务响应非 JSON", providerTaskId: taskId };
  }

  const inner = data.data && typeof data.data === "object" ? (data.data as Record<string, unknown>) : data;
  const st = extractTaskStatus(inner);

  if (FAILED_STATUSES.has(st)) {
    return {
      status: "failed",
      error: extractErrorMessage(inner) ?? `任务状态 ${st || "unknown"}`,
      providerTaskId: taskId,
    };
  }

  const videoFromPayload =
    extractVideoUrlFromTaskPayload(inner) ?? findHttpsVideoUrlDeep(data);

  if (SUCCESS_STATUSES.has(st)) {
    if (!videoFromPayload) {
      return {
        status: "failed",
        error:
          "方舟任务已标记成功，但响应里未找到视频 URL（字段可能与当前解析不一致）。请在控制台 Network 中查看 GET …/contents/generations/tasks 的 JSON 并反馈。",
        providerTaskId: taskId,
      };
    }
    return {
      status: "completed",
      videoUrl: videoFromPayload,
      providerTaskId: taskId,
    };
  }

  /** 个别响应未带 status 字符串但已返回可播放地址 */
  if (videoFromPayload && !st) {
    return {
      status: "completed",
      videoUrl: videoFromPayload,
      providerTaskId: taskId,
    };
  }

  return { status: "processing", providerTaskId: taskId };
}
