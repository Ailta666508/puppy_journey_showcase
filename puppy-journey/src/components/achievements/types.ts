import type { IconName } from "@/components/IconManager";

/** 成就任务 · 用户身份 */
export type TaskOwner = "me" | "partner";

/** 内置兑换券类型 */
export type VoucherType = "milktea" | "film" | "massage" | "shield";

export interface BlindBoxState {
  isAttached: boolean;
  isOpened: boolean;
  voucher: VoucherType | null;
  voiceUrl: string | null;
}

/** 成就条目：均为已完成的打卡记录，仅保留规则分值 */
export interface AchievementTask {
  id: string;
  owner: TaskOwner;
  title: string;
  /** 随手小事 5 / 有点挑战 10 / 突破自我 20 */
  score: number;
  blindBox: BlindBoxState;
  /** ISO 时间，用于瀑布流排序（最新在上） */
  createdAt: string;
}

/** 成就页状态岛 / 小纸条：专注判定与 DB 只读字段一致（is_focusing 优先，并与写入的 status_text「专注中」对齐） */
export function effectivePresenceFocusing(p: Pick<UserPresence, "isFocusing" | "statusText">): boolean {
  if (p.isFocusing === true) return true;
  return (p.statusText ?? "").trim() === "专注中";
}

export interface UserPresence {
  isFocusing: boolean;
  statusText: string;
  /** 头像占位：历史字段；展示优先用 roleAvatarUrl */
  avatar: string;
  /** 按情侣槽位解析的黄/白狗立绘（固定 PNG） */
  roleAvatarUrl: string;
  /** 状态后展示的图标（IconManager name） */
  statusIcon?: IconName | null;
  /** 对方发来的悄悄话未读条数 */
  unreadWhispers?: number;
  /** 对方最近一次发给你的悄悄话正文（展示用，已读不清除正文） */
  lastWhisperReceived?: string | null;
}

export interface UserStatusPair {
  me: UserPresence;
  partner: UserPresence;
}

/** 兑换券与 IconManager 中 name 的映射 */
export const VOUCHER_ICON_NAMES = {
  milktea: "voucherMilktea",
  film: "voucherFilm",
  massage: "voucherMassage",
  shield: "voucherShield",
} as const satisfies Record<VoucherType, IconName>;

export const VOUCHER_LABELS: Record<VoucherType, string> = {
  milktea: "🧋 奶茶券",
  film: "🎬 选片券",
  massage: "💆 捶背券",
  shield: "🛡️ 免死金牌",
};
