/** 状态岛 / 编辑器：是否用 <img> 展示（含 Supabase Storage 公链、站内路径、blob 预览） */
export function isPresenceAvatarImageUrl(s: string): boolean {
  const t = s.trim();
  return (
    /^https?:\/\//i.test(t) ||
    t.startsWith("data:") ||
    (t.startsWith("/") && !t.startsWith("//")) ||
    t.startsWith("blob:")
  );
}
