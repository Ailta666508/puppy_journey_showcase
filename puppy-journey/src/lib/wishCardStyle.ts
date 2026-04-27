/** 与成就页 TaskCard 一致的马卡龙手账底色 + 微倾斜 */
export const WISH_MACARON_BG = [
  "bg-orange-50/80",
  "bg-purple-50/80",
  "bg-blue-50/80",
  "bg-rose-50/80",
] as const;

export const WISH_MACARON_BORDER = [
  "border-orange-200/70",
  "border-purple-200/70",
  "border-blue-200/70",
  "border-rose-200/70",
] as const;

export const WISH_PILL_BG = [
  "bg-orange-300",
  "bg-purple-300",
  "bg-blue-300",
  "bg-rose-300",
] as const;

export const WISH_DASHED = [
  "border-orange-200",
  "border-purple-200",
  "border-blue-200",
  "border-rose-200",
] as const;

export const WISH_TILT = ["-rotate-2", "-rotate-1", "rotate-0", "rotate-1", "rotate-2"] as const;

export function wishStyleSeed(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) {
    h = (h * 31 + id.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

