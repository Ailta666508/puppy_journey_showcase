/**
 * 旅行页「Q 版生成器」调用火山方舟图像接口所需的凭证。
 *
 * 在 `puppy-journey/.env.local` 中配置（勿提交、勿加 NEXT_PUBLIC_ 前缀）：
 * - VOLCENGINE_Q_AVATAR_API_KEY
 * - VOLCENGINE_Q_AVATAR_ENDPOINT_ID（推理接入点 ID，如 ep-xxxx）
 */

import { config as loadDotenvFile } from "dotenv";
import fs from "node:fs";
import path from "node:path";

function dirHasNextConfig(dir: string): boolean {
  return (
    fs.existsSync(path.join(dir, "next.config.ts")) ||
    fs.existsSync(path.join(dir, "next.config.mjs")) ||
    fs.existsSync(path.join(dir, "next.config.js"))
  );
}

/** 单级子目录里找 Next 应用（cwd 在 monorepo 根如「滑雪小狗」时仍能定位 puppy-journey） */
function findFirstChildNextAppRoot(parent: string): string | null {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(parent, { withFileTypes: true });
  } catch {
    return null;
  }
  const dirs = entries.filter((e) => e.isDirectory() && !e.name.startsWith("."));
  dirs.sort((a, b) => a.name.localeCompare(b.name));
  for (const e of dirs) {
    const child = path.join(parent, e.name);
    if (dirHasNextConfig(child)) return child;
  }
  return null;
}

/** 从当前 cwd 向上查找含 next.config 的目录，避免 Turbopack/子进程 cwd 不在项目根时读不到 .env.local */
function resolveNextAppRoot(): string {
  let dir = path.resolve(process.cwd());
  for (let depth = 0; depth < 12; depth++) {
    if (dirHasNextConfig(dir)) return dir;
    const nested = findFirstChildNextAppRoot(dir);
    if (nested) return nested;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  const fallback = path.resolve(process.cwd());
  const nested = findFirstChildNextAppRoot(fallback);
  return nested ?? fallback;
}

let diskEnvLoaded = false;

/** 从项目根 .env.local / .env 补全 process.env（Turbopack 子进程等场景） */
export function loadAppEnvFromDisk(): void {
  if (diskEnvLoaded) return;
  diskEnvLoaded = true;
  const root = resolveNextAppRoot();
  for (const name of [".env.local", ".env"] as const) {
    const filePath = path.join(root, name);
    if (fs.existsSync(filePath)) {
      // 不 override：与 Next 已注入的变量并存；子进程里未注入时从磁盘补上
      // override：避免 Next/Turbopack 子进程里占位空串导致读不到你在 .env.local 里配置的 Key
      loadDotenvFile({ path: filePath, override: true });
    }
  }
}

export type QAvatarVolcengineCredentials = {
  apiKey: string;
  endpointId: string;
};

export function getQAvatarVolcengineCredentials(): QAvatarVolcengineCredentials | null {
  loadAppEnvFromDisk();
  const apiKey = process.env.VOLCENGINE_Q_AVATAR_API_KEY?.trim() ?? "";
  const endpointId = process.env.VOLCENGINE_Q_AVATAR_ENDPOINT_ID?.trim() ?? "";
  if (!apiKey || !endpointId) return null;
  return { apiKey, endpointId };
}

function buildEnvHint(): string {
  const keys = "VOLCENGINE_Q_AVATAR_API_KEY 与 VOLCENGINE_Q_AVATAR_ENDPOINT_ID";
  if (process.env.VERCEL) {
    return `请在部署平台（如 Vercel）的 Environment Variables 中设置 ${keys} 后重新部署。线上不会读取本机 .env.local。`;
  }
  if (process.env.NODE_ENV === "production") {
    return `当前为生产模式：请在运行环境中设置 ${keys}（例如服务器环境变量或 .env.production.local），本地 .env.local 仅对 next dev 生效。`;
  }
  return `请在 puppy-journey 根目录创建「.env.local」（注意文件名以 . 开头）并设置 ${keys}，保存后重启 pnpm dev；勿使用无点的 env.local。`;
}

/** 未配置时返回给前端的提示文案 */
export const Q_AVATAR_ENV_HINT = buildEnvHint();
