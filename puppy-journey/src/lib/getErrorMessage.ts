/** 将未知异常、Supabase/PostgREST 等对象型错误转为可读文案，避免界面出现 [object Object] */

export function getErrorMessage(e: unknown): string {
  if (e == null) return "未知错误";
  if (typeof e === "string") {
    const t = e.trim();
    return t.length > 0 ? t : "未知错误";
  }
  if (e instanceof Error) {
    const m = e.message?.trim();
    if (m && m.length > 0) return m;
    return e.name || "Error";
  }
  if (typeof e === "object") {
    const o = e as Record<string, unknown>;
    const parts: string[] = [];
    if (typeof o.message === "string" && o.message.trim()) parts.push(o.message.trim());
    if (typeof o.details === "string" && o.details.trim()) parts.push(o.details.trim());
    if (typeof o.hint === "string" && o.hint.trim()) parts.push(o.hint.trim());
    if (typeof o.code === "string" && o.code.trim()) parts.push(`(${o.code})`);
    if (parts.length > 0) return parts.join(" — ");
    try {
      return JSON.stringify(o);
    } catch {
      return "未知错误（无法序列化）";
    }
  }
  return String(e);
}

/** API JSON 里的 error 字段可能是字符串或对象 */
export function getApiErrorField(error: unknown, fallback: string): string {
  if (error == null) return fallback;
  if (typeof error === "string") {
    const t = error.trim();
    return t.length > 0 ? t : fallback;
  }
  const m = getErrorMessage(error).trim();
  return m.length > 0 ? m : fallback;
}
