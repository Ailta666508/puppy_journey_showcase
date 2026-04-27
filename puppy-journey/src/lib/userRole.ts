export type UserRole = "white_dog" | "yellow_dog";

const ROLES = new Set<UserRole>(["white_dog", "yellow_dog"]);

/** 黄狗/白狗在 UI 中的统一展示（头像印章、称呼）；由 author_id / 情侣槽位 → role 后再查此表 */
export const ROLE_INFO = {
  yellow_dog: {
    label: "小鸡毛",
    stampSrc: "/achievements/achievement-stamp-yellow.png",
    /** 状态岛 / 成就卡角色立绘（固定资源，不依赖上传） */
    avatarSrc: "/achievements/role-yellow-dog.png",
    emoji: "🐕",
  },
  white_dog: {
    label: "小白",
    stampSrc: "/achievements/achievement-stamp-white.png",
    avatarSrc: "/achievements/role-white-dog.png",
    emoji: "🐶",
  },
} as const satisfies Record<
  UserRole,
  { label: string; stampSrc: string; avatarSrc: string; emoji: string }
>;

export function isUserRole(x: unknown): x is UserRole {
  return typeof x === "string" && ROLES.has(x as UserRole);
}

/** 从请求体解析黄狗/白狗角色（仅 UUID 体系下保留；勿再依赖已删除的 user_id 列） */
export function parseUserRoleFromBody(body: Record<string, unknown>): UserRole | null {
  const v = body.userId ?? body.role;
  return isUserRole(v) ? v : null;
}

export function partnerRole(role: UserRole): UserRole {
  return role === "white_dog" ? "yellow_dog" : "white_dog";
}

/** UI 文案：与情侣空间选角一致 */
export function userRoleDisplayName(role: UserRole): string {
  return role === "yellow_dog" ? "小鸡毛" : "小白";
}

/** UUID v4 */
export function isUuid(s: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    s.trim(),
  );
}
