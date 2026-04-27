/** 仅允许站内相对路径，避免开放重定向 */
export function safeRedirectPath(raw: string | null | undefined): string {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//")) return "/";
  return raw;
}
