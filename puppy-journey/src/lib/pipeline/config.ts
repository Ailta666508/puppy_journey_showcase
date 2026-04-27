/**
 * 管线配置（配置驱动）：换模型优先改本文件常量 + .env 中的 Key/URL。
 * 环境变量名与 .env.local 注释保持一致，便于你对照填写。
 */

import { loadAppEnvFromDisk } from "@/lib/qAvatarVolcengineConfig";

/** —— Agent 1：剧本 LLM（OpenAI 兼容 Chat Completions）—— */
export const SCRIPT_LLM_MODEL_DEFAULT = "gpt-4o";

const VOLC_ARK_CHAT_BASE = "https://ark.cn-beijing.volces.com/api/v3";

/** —— Agent 3：视频提供方 —— */
export type VideoProviderKind = "mock" | "http";

/** 未显式设置 PIPELINE_VIDEO_PROVIDER 时：有 Key+BASE 则走方舟真接口，否则 mock */
export const VIDEO_PROVIDER_DEFAULT: VideoProviderKind = "mock";

/** 方舟图生视频：创建任务（与官方 curl 一致） */
export const ARK_VIDEO_CREATE_TASK_PATH = "/contents/generations/tasks";

/** 方舟图生视频：查询单个任务，{id} 为 cgt-… 任务 id */
export const ARK_VIDEO_GET_TASK_PATH_TEMPLATE = "/contents/generations/tasks/{id}";

/** 未配置 model/ep 时的默认图生视频模型名（可在 .env 覆盖） */
export const PIPELINE_VIDEO_MODEL_DEFAULT = "doubao-seedance-1-5-pro-251215";

/** @deprecated 使用 ARK_VIDEO_CREATE_TASK_PATH */
export const VIDEO_HTTP_SUBMIT_PATH = ARK_VIDEO_CREATE_TASK_PATH;

/** @deprecated 使用 ARK_VIDEO_GET_TASK_PATH_TEMPLATE */
export const VIDEO_HTTP_STATUS_PATH_TEMPLATE = ARK_VIDEO_GET_TASK_PATH_TEMPLATE;

function trim(s: string | undefined): string {
  return (s ?? "").trim();
}

/**
 * 剧本模型：优先读专用 env，未设置时回退 VITE_LLM_*（兼容旧配置）。
 *
 * .env.local 示例见仓库根 .env.example
 */
export function getScriptLlmRuntimeConfig() {
  loadAppEnvFromDisk();
  const apiKey =
    trim(process.env.PIPELINE_SCRIPT_LLM_API_KEY) ||
    trim(process.env.VITE_LLM_API_KEY);
  const model =
    trim(process.env.PIPELINE_SCRIPT_LLM_MODEL) ||
    trim(process.env.PIPELINE_SCRIPT_LLM_ENDPOINT_ID) ||
    trim(process.env.VITE_LLM_MODEL) ||
    SCRIPT_LLM_MODEL_DEFAULT;
  const pipelineBaseOnly = trim(process.env.PIPELINE_SCRIPT_LLM_BASE_URL);
  const viteBase = trim(process.env.VITE_LLM_API_URL);
  /** ep- 接入点必须走方舟；勿被 VITE 里默认的 api.openai.com 覆盖 */
  const baseUrl = (
    pipelineBaseOnly ||
    (model.startsWith("ep-") ? VOLC_ARK_CHAT_BASE : "") ||
    viteBase ||
    "https://api.openai.com/v1"
  ).replace(/\/$/, "");
  return { apiKey, baseUrl, model };
}

export function assertScriptLlmConfigured() {
  const { apiKey } = getScriptLlmRuntimeConfig();
  if (!apiKey) {
    throw new Error(
      "未配置 PIPELINE_SCRIPT_LLM_API_KEY（或兼容项 VITE_LLM_API_KEY）。请在 puppy-journey/.env.local 中设置。",
    );
  }
}

/** 视频：HTTP 轮询第三方时的连接信息 */
export function getVideoHttpRuntimeConfig() {
  loadAppEnvFromDisk();
  /** 与 Agent 2 共用同一方舟 Key 时，只配 VOLCENGINE_* 也能走真实视频接口 */
  const apiKey =
    trim(process.env.PIPELINE_VIDEO_API_KEY) ||
    trim(process.env.ARK_API_KEY) ||
    trim(process.env.VOLCENGINE_Q_AVATAR_API_KEY);
  const endpointId = trim(process.env.PIPELINE_VIDEO_ENDPOINT_ID);
  /** 图生视频 tasks 接口的 model 须为产品名（如 doubao-seedance-…），勿把 ep- 接入点 ID 当 model */
  const explicitModel = trim(process.env.PIPELINE_VIDEO_MODEL);
  const model =
    explicitModel && !explicitModel.startsWith("ep-")
      ? explicitModel
      : PIPELINE_VIDEO_MODEL_DEFAULT;
  const explicitBase = trim(process.env.PIPELINE_VIDEO_BASE_URL);
  const baseUrl = (
    explicitBase ||
    (endpointId.startsWith("ep-") ? VOLC_ARK_CHAT_BASE : "") ||
    (apiKey ? VOLC_ARK_CHAT_BASE : "")
  ).replace(/\/$/, "");
  const explicitProvider = trim(process.env.PIPELINE_VIDEO_PROVIDER).toLowerCase();
  const credsOk = Boolean(apiKey && baseUrl);
  const forceMockWithCreds =
    credsOk &&
    explicitProvider === "mock" &&
    (trim(process.env.PIPELINE_VIDEO_FORCE_MOCK) === "1" ||
      trim(process.env.PIPELINE_VIDEO_FORCE_MOCK).toLowerCase() === "true");

  /** 有 Key+BASE 时默认走方舟；仅当同时设 PIPELINE_VIDEO_PROVIDER=mock 且 PIPELINE_VIDEO_FORCE_MOCK=1 时才在有凭证下仍用占位视频 */
  let provider: VideoProviderKind;
  if (credsOk && !forceMockWithCreds) {
    provider = "http";
  } else if (!credsOk && explicitProvider === "http") {
    provider = "http";
  } else {
    provider = "mock";
  }
  return { apiKey, baseUrl, model, provider };
}
