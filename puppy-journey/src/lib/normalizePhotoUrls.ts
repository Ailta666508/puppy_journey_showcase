import { tryExpandSupabaseStorageRef } from "@/lib/supabaseStoragePublicUrl";

/** 将 travel_logs.photo_urls（JSON 数组/字符串、混有对象的数组、类数组对象等）规范为可给 <img src> 的 string[] */

function stringToDisplayablePhotoUrl(s: string): string | null {
  const t = s.trim();
  if (!t) return null;
  const fromSb = tryExpandSupabaseStorageRef(t);
  if (fromSb) return fromSb;
  if (t.startsWith("http://") || t.startsWith("https://") || t.startsWith("data:")) return t;
  return null;
}

export function coercePhotoUrlItem(x: unknown): string | null {
  if (x == null) return null;
  if (typeof x === "string") {
    return stringToDisplayablePhotoUrl(x);
  }
  if (typeof x === "object") {
    const o = x as Record<string, unknown>;
    for (const key of ["url", "src", "href", "publicUrl", "public_url", "signedUrl", "signed_url", "r"]) {
      const v = o[key];
      if (typeof v === "string" && v.trim().length > 0) {
        const u = stringToDisplayablePhotoUrl(v);
        if (u) return u;
      }
    }
    if (o.t === "i" && typeof o.m === "string" && typeof o.d === "string" && o.d.length > 0) {
      return `data:${o.m};base64,${o.d}`;
    }
  }
  return null;
}

function isArrayLikeRecord(obj: Record<string, unknown>): boolean {
  const keys = Object.keys(obj);
  if (keys.length === 0) return false;
  return keys.every((k) => /^\d+$/.test(k));
}

export function normalizePhotoUrls(raw: unknown): string[] {
  const out: string[] = [];
  const pushFlat = (x: unknown) => {
    if (Array.isArray(x)) {
      for (const el of x) pushFlat(el);
      return;
    }
    const u = coercePhotoUrlItem(x);
    if (u) out.push(u);
  };

  if (raw == null) return [];

  if (Array.isArray(raw)) {
    for (const el of raw) pushFlat(el);
    return out;
  }

  if (typeof raw === "object") {
    const o = raw as Record<string, unknown>;
    const nested = o.urls ?? o.photoUrls ?? o.photo_urls ?? o.photos;
    if (Array.isArray(nested)) {
      for (const el of nested) pushFlat(el);
      return out;
    }
    if (isArrayLikeRecord(o)) {
      const keys = Object.keys(o).sort((a, b) => Number(a) - Number(b));
      for (const k of keys) pushFlat(o[k]);
      return out;
    }
    pushFlat(raw);
    return out;
  }

  if (typeof raw === "string") {
    const t = raw.trim();
    if (!t) return [];
    try {
      const p = JSON.parse(t) as unknown;
      return normalizePhotoUrls(p);
    } catch {
      const expanded = tryExpandSupabaseStorageRef(t);
      if (expanded) return [expanded];
      if (t.startsWith("data:") || t.startsWith("http://") || t.startsWith("https://")) {
        return [t];
      }
      return [];
    }
  }

  return [];
}
