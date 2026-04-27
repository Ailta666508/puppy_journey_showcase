/**
 * 与 @supabase/storage-js getPublicUrl 一致的公开地址拼接（直接依赖项目 URL，避免客户端 Storage 实例 url 异常时 publicUrl 为空）。
 *
 * @see https://supabase.com/docs/guides/storage/serving/downloads
 */
export function buildSupabaseStoragePublicUrl(bucket: string, objectPath: string): string {
  const raw =
    typeof process !== "undefined" && process.env.NEXT_PUBLIC_SUPABASE_URL
      ? process.env.NEXT_PUBLIC_SUPABASE_URL
      : "";
  const base = raw.replace(/\/+$/, "");
  if (!base) {
    throw new Error("缺少 NEXT_PUBLIC_SUPABASE_URL，无法生成 Storage 公网地址");
  }
  const b = bucket.replace(/^\/+|\/+$/g, "");
  const p = objectPath.replace(/^\/+/, "");
  if (!b || !p) throw new Error("Storage 路径无效");
  return encodeURI(`${base}/storage/v1/object/public/${b}/${p}`);
}

/** migration / photo_items 使用的形如 sb:bucket:path/to/file 的引用 */
const SB_REF_RE = /^sb:([^:]+):(.+)$/;

/** 浏览器端无 env 时返回 null，不抛错 */
export function tryExpandSupabaseStorageRef(maybeRef: string): string | null {
  const t = maybeRef.trim();
  const m = t.match(SB_REF_RE);
  if (!m) return null;
  const bucket = (m[1] ?? "").replace(/^\/+|\/+$/g, "");
  const path = (m[2] ?? "").replace(/^\/+/, "");
  if (!bucket || !path) return null;
  try {
    return buildSupabaseStoragePublicUrl(bucket, path);
  } catch {
    return null;
  }
}
