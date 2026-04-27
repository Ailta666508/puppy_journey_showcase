import type { SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";

import { buildSupabaseStoragePublicUrl } from "@/lib/supabaseStoragePublicUrl";

import { getUserUploadsBucket } from "@/lib/supabase/userUploadsBucket";

import { MAX_TRAVEL_INLINE_FILE_BYTES } from "@/lib/travelPhotoItems";

const DATA_URL_RE = /^data:([^;]*);base64,(.+)$/i;

export function parseImageDataUrl(dataUrl: string): { mime: string; bytes: Buffer } | null {
  const m = dataUrl.trim().match(DATA_URL_RE);
  if (!m) return null;
  const mime = (m[1] || "application/octet-stream").trim() || "application/octet-stream";
  const b64 = m[2] || "";
  if (!b64) return null;
  try {
    const bytes = Buffer.from(b64, "base64");
    if (!bytes.length) return null;
    if (bytes.length > MAX_TRAVEL_INLINE_FILE_BYTES) return null;
    return { mime, bytes };
  } catch {
    return null;
  }
}

function mimeToExt(mime: string): string {
  const m = mime.toLowerCase().split(";")[0].trim();
  if (m === "image/jpeg" || m === "image/jpg") return "jpg";
  if (m === "image/png") return "png";
  if (m === "image/webp") return "webp";
  if (m === "image/gif") return "gif";
  return "bin";
}

function safeSegment(s: string, max: number): string {
  return s.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, max) || "image";
}

function inferImageMimeFromFileName(name: string): string {
  const n = name.toLowerCase();
  if (n.endsWith(".png")) return "image/png";
  if (n.endsWith(".jpg") || n.endsWith(".jpeg")) return "image/jpeg";
  if (n.endsWith(".webp")) return "image/webp";
  if (n.endsWith(".gif")) return "image/gif";
  return "";
}

function normalizeImageContentType(declared: string | undefined, fileName: string): string {
  const d = (declared ?? "").split(";")[0].trim().toLowerCase();
  if (d && d !== "application/octet-stream" && /^image\/(jpeg|jpg|png|webp|gif)$/i.test(d)) {
    return d === "image/jpg" ? "image/jpeg" : d;
  }
  const inferred = inferImageMimeFromFileName(fileName);
  if (inferred) return inferred;
  return "";
}

/** 原始字节上传 Storage（供 multipart 接口使用，避免 JSON+Base64 撑爆请求体上限） */
export async function uploadImageBufferToUserUploads(
  supabase: SupabaseClient,
  userId: string,
  bytes: Buffer,
  contentType: string | undefined,
  originalFileName?: string,
): Promise<string> {
  if (!bytes.length) throw new Error("图片数据为空");
  if (bytes.length > MAX_TRAVEL_INLINE_FILE_BYTES) {
    throw new Error(`图片须不超过 ${Math.round(MAX_TRAVEL_INLINE_FILE_BYTES / (1024 * 1024))}MB`);
  }
  const nameHint = originalFileName?.trim() || "photo.jpg";
  const mime = normalizeImageContentType(contentType, nameHint);
  if (!mime) throw new Error("无法识别图片类型，请使用 jpg/png/webp/gif");
  const allowed = /^image\/(jpeg|png|webp|gif)$/i.test(mime);
  if (!allowed) throw new Error("仅支持 jpeg / png / webp / gif");

  const bucket = getUserUploadsBucket();
  const safeUser = safeSegment(userId, 64);
  const ext = mimeToExt(mime);
  const stamp = randomUUID();
  const stem = nameHint.replace(/\.[^.]+$/, "").trim() || "photo";
  const base = safeSegment(stem, 48) || "photo";
  const objectPath = `${safeUser}/${stamp}-${base}.${ext}`;

  const { error } = await supabase.storage.from(bucket).upload(objectPath, bytes, {
    contentType: mime,
    upsert: false,
  });
  if (error) throw new Error(error.message || "Storage 上传失败");

  return buildSupabaseStoragePublicUrl(bucket, objectPath);
}

/**
 * 将 Data URL 上传至 Supabase Storage，返回公开访问 URL（需 bucket 为 public 或走你已配置的 CDN）。
 */
export async function uploadTravelDataUrlToUserUploads(
  supabase: SupabaseClient,
  userId: string,
  dataUrl: string,
  originalFileName?: string,
): Promise<string> {
  const parsed = parseImageDataUrl(dataUrl);
  if (!parsed) throw new Error("图片格式无效（需为带 base64 的 Data URL，或体积超过上限）");
  const mime = parsed.mime.split(";")[0].trim();
  const allowed = /^image\/(jpeg|jpg|png|webp|gif)$/i.test(mime);
  if (!allowed) throw new Error("仅支持 jpeg / png / webp / gif");
  return uploadImageBufferToUserUploads(supabase, userId, parsed.bytes, mime, originalFileName);
}

export async function resolveTravelLogPhotoUrlsForPersistence(
  supabase: SupabaseClient,
  userId: string,
  urls: string[],
): Promise<string[]> {
  return Promise.all(
    urls.map(async (u) => {
      const t = u.trim();
      if (!t) throw new Error("存在空的图片数据");
      if (t.startsWith("data:")) {
        return uploadTravelDataUrlToUserUploads(supabase, userId, t);
      }
      return t;
    }),
  );
}
