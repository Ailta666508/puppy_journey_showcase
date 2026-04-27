import {
  requireCoupleWorkspaceContext,
  type CoupleWorkspaceContext,
  type CoupleWorkspaceContextResult,
} from "@/lib/couple/coupleWorkspaceContext";

export type AchievementContext = CoupleWorkspaceContext;

export type AchievementContextResult = CoupleWorkspaceContextResult;

/** 成就 / 状态岛：必须已登录、已绑定情侣空间；成员身份以 couples 两槽为准。 */
export async function requireAchievementContext(request: Request): Promise<AchievementContextResult> {
  return requireCoupleWorkspaceContext(request);
}
