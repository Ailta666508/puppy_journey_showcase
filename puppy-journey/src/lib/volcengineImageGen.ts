/**
 * 火山引擎方舟图像生成（OpenAI API 兼容模式）。
 * 使用官方 OpenAI SDK，Base URL 指向方舟 v3。
 *
 * 环境变量（与 Q 版模块共用）：
 * - VOLCENGINE_Q_AVATAR_API_KEY
 * - VOLCENGINE_Q_AVATAR_ENDPOINT_ID（作为 model / 推理接入点 ID）
 */

import OpenAI from "openai";

import {
  getQAvatarVolcengineCredentials,
  Q_AVATAR_ENV_HINT,
} from "@/lib/qAvatarVolcengineConfig";

/** 方舟 OpenAI 兼容根路径（勿带末尾斜杠后的多余 path） */
export const VOLC_ARK_OPENAI_BASE_URL = "https://ark.cn-beijing.volces.com/api/v3";

export type VolcImageGenOptions = {
  /** 尺寸：如 1K、2K 等，以方舟/模型文档为准；默认 2K */
  size?: string;
  /** 默认 url，便于直接拿到可访问链接 */
  responseFormat?: "url" | "b64_json";
};

function createArkClient(apiKey: string): OpenAI {
  return new OpenAI({
    apiKey,
    baseURL: VOLC_ARK_OPENAI_BASE_URL,
  });
}

type ArkImageGenerateBody = {
  model: string;
  prompt: string;
  size?: string;
  response_format?: "url" | "b64_json";
  /** 火山多图垫图：与现有 Q 版路由一致 */
  image?: string[];
};

function firstItem(resp: OpenAI.Images.ImagesResponse | { data?: Array<{ url?: string; b64_json?: string }> }) {
  const data = resp.data;
  if (!data?.length) return undefined;
  return data[0];
}

/**
 * 通用文生图：`prompt` 必须由调用方传入，本模块不内置任何示例提示词。
 * @returns 根据 responseFormat 返回 url 或 base64 JSON 字段（二选一由方舟返回决定）
 */
export async function generateVolcImage(
  prompt: string,
  options?: VolcImageGenOptions,
): Promise<{ url?: string; b64Json?: string }> {
  const text = prompt?.trim();
  if (!text) {
    throw new Error("generateVolcImage: prompt 不能为空");
  }

  const creds = getQAvatarVolcengineCredentials();
  if (!creds) {
    throw new Error(Q_AVATAR_ENV_HINT);
  }

  const size = options?.size ?? "2K";
  const response_format = options?.responseFormat ?? "url";

  const client = createArkClient(creds.apiKey);

  const body: ArkImageGenerateBody = {
    model: creds.endpointId,
    prompt: text,
    size,
    response_format,
  };

  try {
    const resp = await client.images.generate(body as unknown as OpenAI.Images.ImageGenerateParams);
    const item = firstItem(resp);
    const url = item?.url;
    const b64Json = item?.b64_json;

    if (response_format === "url") {
      if (!url?.trim()) {
        throw new Error("generateVolcImage: 模型未返回图片 URL");
      }
      return { url: url.trim() };
    }
    if (!b64Json?.trim()) {
      throw new Error("generateVolcImage: 模型未返回 b64_json");
    }
    return { b64Json: b64Json.trim() };
  } catch (err) {
    console.error("[generateVolcImage] 火山引擎图像生成失败", err);
    if (err instanceof Error) throw err;
    throw new Error(String(err));
  }
}

export type VolcImageMultiOptions = VolcImageGenOptions & {
  /** data URL 或纯 base64 数组，顺序与业务约定一致（如首张用户图 + 参考图） */
  images: string[];
  responseFormat: "url" | "b64_json";
};

/**
 * 多图输入生图（Q 版垫图等）。prompt 仍全部由调用方传入。
 */
export async function generateVolcImageWithImages(
  prompt: string,
  options: VolcImageMultiOptions,
): Promise<{ url?: string; b64Json?: string }> {
  const text = prompt?.trim();
  if (!text) {
    throw new Error("generateVolcImageWithImages: prompt 不能为空");
  }
  if (!options.images?.length) {
    throw new Error("generateVolcImageWithImages: images 不能为空");
  }

  const creds = getQAvatarVolcengineCredentials();
  if (!creds) {
    throw new Error(Q_AVATAR_ENV_HINT);
  }

  const client = createArkClient(creds.apiKey);
  const size = options.size ?? "2K";
  const response_format = options.responseFormat;

  const body: ArkImageGenerateBody = {
    model: creds.endpointId,
    prompt: text,
    image: options.images,
    response_format,
    ...(size ? { size } : {}),
  };

  try {
    const resp = await client.images.generate(body as unknown as OpenAI.Images.ImageGenerateParams);
    const item = firstItem(resp);
    const url = item?.url;
    const b64Json = item?.b64_json;

    if (response_format === "url") {
      if (!url?.trim()) {
        throw new Error("generateVolcImageWithImages: 模型未返回图片 URL");
      }
      return { url: url.trim() };
    }
    if (!b64Json?.trim()) {
      throw new Error("generateVolcImageWithImages: 模型未返回 b64_json");
    }
    return { b64Json: b64Json.trim() };
  } catch (err) {
    console.error("[generateVolcImageWithImages] 火山引擎图像生成失败", err);
    if (err instanceof Error) throw err;
    throw new Error(String(err));
  }
}
