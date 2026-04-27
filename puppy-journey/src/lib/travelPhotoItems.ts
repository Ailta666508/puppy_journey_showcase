/** 旅行图 Base64：仅客户端读图上限常量； DB 仅存 travel_logs.photo_urls */

export type TravelPhotoItemStored =
  | { t: "s"; r: string }
  | { t: "i"; m: string; d: string };

/** Data URL 内 base64 段最大长度（约 9MB 量级，与单文件上限匹配） */
export const MAX_TRAVEL_INLINE_BASE64_LEN = 12_000_000;

/** 与旅行页选图单张上限一致 */
export const MAX_TRAVEL_INLINE_FILE_BYTES = 8 * 1024 * 1024;

export function isTravelPhotoItemStored(x: unknown): x is TravelPhotoItemStored {
  if (!x || typeof x !== "object") return false;
  const o = x as Record<string, unknown>;
  if (o.t === "s") return typeof o.r === "string" && o.r.trim().length > 0;
  if (o.t === "i") {
    return (
      typeof o.m === "string" &&
      o.m.trim().length > 0 &&
      typeof o.d === "string" &&
      o.d.length > 0 &&
      o.d.length <= MAX_TRAVEL_INLINE_BASE64_LEN
    );
  }
  return false;
}

export function parseTravelPhotoItems(raw: unknown): TravelPhotoItemStored[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const out: TravelPhotoItemStored[] = [];
  for (const el of raw) {
    if (!isTravelPhotoItemStored(el)) return null;
    out.push(el);
  }
  return out;
}
