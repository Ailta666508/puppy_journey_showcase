import { cn } from "@/lib/utils";

/**
 * 成就页主操作（底部 FAB、新增成就主按钮等）与心愿墙「添加心愿」入口共用的视觉令牌，
 * 与 `globals.css` 中 `.pj-btn-gradient` 保持一致。
 */
export interface AchievementPrimaryActionTokens {
  /** 渐变主按钮背景（圆钮 / 矩形主 CTA） */
  gradientSurface: string;
  /** 与 FAB 一致的阴影层级 */
  fabShadow: string;
}

export const achievementPrimaryActionTokens: AchievementPrimaryActionTokens = {
  gradientSurface: "pj-btn-gradient",
  fabShadow: "shadow-lg",
};

/** 圆形添加按钮（与成就页 FloatingActionButton 同款）的 className 片段 */
export function achievementPrimaryCircularFabClasses(extra?: string): string {
  return cn(
    "flex h-14 w-14 items-center justify-center rounded-full text-white",
    achievementPrimaryActionTokens.gradientSurface,
    achievementPrimaryActionTokens.fabShadow,
    extra,
  );
}
