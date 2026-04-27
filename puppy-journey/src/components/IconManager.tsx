/**
 * 全局图标适配器（Icon Manager）
 * ------------------------------------------------------------
 * 所有成就页等指定模块的图标必须经此组件渲染，禁止在业务组件中直接 import lucide-react。
 * 后续替换为本地 PNG/SVG 时，只需改本文件的映射即可。
 */
"use client";

import type { ComponentType } from "react";
import type { LucideIcon } from "lucide-react";
import {
  Check,
  ChevronDown,
  Clapperboard,
  Coffee,
  Dumbbell,
  Gift,
  Hand,
  Heart,
  Mail,
  Lock,
  Mic,
  PackageOpen,
  Play,
  Plus,
  Shield,
  Sparkles,
  Square,
  SquareCheck,
  Target,
  Trash2,
  User,
  Volume2,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";

/** 带锁孔的微型礼物盒（占位：Gift + Lock 叠放） */
function GiftLockedIcon({ className, size = 20 }: { className?: string; size?: number }) {
  const s = typeof size === "number" ? size : 20;
  return (
    <span className={cn("relative inline-flex shrink-0 items-center justify-center", className)} style={{ width: s, height: s }}>
      <Gift className="text-foreground" style={{ width: s * 0.9, height: s * 0.9 }} strokeWidth={2} />
      <Lock
        className="absolute right-0 bottom-0 text-muted-foreground"
        style={{ width: s * 0.42, height: s * 0.42 }}
        strokeWidth={2.5}
      />
    </span>
  );
}

/** 打开的礼物盒 + 小头像占位 */
function GiftOpenWithPartnerIcon({ className, size = 20 }: { className?: string; size?: number }) {
  const s = typeof size === "number" ? size : 20;
  return (
    <span className={cn("relative inline-flex shrink-0 items-center justify-center", className)} style={{ width: s * 1.4, height: s }}>
      <PackageOpen className="text-primary" style={{ width: s * 0.95, height: s * 0.95 }} strokeWidth={2} />
      <User
        className="absolute -right-0.5 top-1/2 -translate-y-1/2 rounded-full bg-muted p-0.5 text-muted-foreground"
        style={{ width: s * 0.55, height: s * 0.55 }}
        strokeWidth={2}
      />
    </span>
  );
}

type IconComponent = LucideIcon | ComponentType<{ className?: string; size?: number }>;

/**
 * 图标名字典：业务侧只用 name 字符串引用。
 * 兑换券类：后续可改为同一 name 指向本地素材。
 */
export const ICON_MAP = {
  // 通用
  gift: Gift,
  giftOpen: PackageOpen,
  giftLocked: GiftLockedIcon,
  giftOpenPartner: GiftOpenWithPartnerIcon,
  lock: Lock,
  square: Square,
  check: Check,
  checkSquare: SquareCheck,
  plus: Plus,
  mic: Mic,
  sparkles: Sparkles,
  chevronDown: ChevronDown,
  close: X,
  coffee: Coffee,
  dumbbell: Dumbbell,
  heart: Heart,
  /** 悄悄话未读等：信封占位，后续可换素材 */
  envelope: Mail,
  target: Target,
  trash: Trash2,
  user: User,
  play: Play,
  volume: Volume2,
  // 兑换券（🧋 奶茶、🎬 选片、💆 捶背、🛡️ 免死金牌）
  voucherMilktea: Coffee,
  voucherFilm: Clapperboard,
  voucherMassage: Hand,
  voucherShield: Shield,
} as const satisfies Record<string, IconComponent>;

export type IconName = keyof typeof ICON_MAP;

export type IconProps = {
  name: IconName;
  className?: string;
  /** 近似像素尺寸，传给 lucide 的 size */
  size?: number;
};

export function Icon({ name, className, size = 20 }: IconProps) {
  const Cmp = ICON_MAP[name];
  if (!Cmp) return null;
  return <Cmp className={className} size={size} />;
}
