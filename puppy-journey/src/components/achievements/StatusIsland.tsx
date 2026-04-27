"use client";

import { motion } from "framer-motion";
import { Icon } from "@/components/IconManager";
import type { IconName } from "@/components/IconManager";
import { type UserPresence, effectivePresenceFocusing } from "./types";

type Props = {
  me: UserPresence;
  partner: UserPresence;
  onAvatarClick: (role: "me" | "partner") => void;
};

/** 顶部紧凑状态岛：双头像可点；文案 + 小图标；未读悄悄话为呼吸信封 + 条数 */
export function StatusIsland({ me, partner, onAvatarClick }: Props) {
  return (
    <div className="relative z-30 flex justify-center px-4 pt-2">
      <motion.div
        className="flex items-center rounded-full border border-white/70 bg-white/55 px-3 py-2 shadow-md backdrop-blur-md"
        initial={{ opacity: 0, y: -12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ type: "spring", stiffness: 380, damping: 28 }}
      >
        <button
          type="button"
          onClick={() => onAvatarClick("me")}
          className="rounded-xl outline-none ring-offset-2 focus-visible:ring-2 focus-visible:ring-ring"
          aria-label="我的状态"
        >
          <AvatarSlot presence={me} variant="me" />
        </button>
        <Icon name="heart" className="mx-3 h-5 w-5 shrink-0 text-pink-400 animate-pulse" size={20} />
        <button
          type="button"
          onClick={() => onAvatarClick("partner")}
          className="rounded-xl outline-none ring-offset-2 focus-visible:ring-2 focus-visible:ring-ring"
          aria-label="对方状态"
        >
          <AvatarSlot presence={partner} variant="partner" />
        </button>
      </motion.div>
    </div>
  );
}

function AvatarSlot({ presence, variant }: { presence: UserPresence; variant: "me" | "partner" }) {
  const focusing = effectivePresenceFocusing(presence);
  const label = focusing ? "专注中 🤫" : presence.statusText;
  const icon = focusing ? null : ((presence.statusIcon as IconName | null) ?? null);
  /** 仅「我」展示未读：悄悄话记在接收方 profile 行上 */
  const unread = variant === "me" ? (presence.unreadWhispers ?? 0) : 0;
  const avatarSrc = presence.roleAvatarUrl;

  return (
    <div className="flex flex-col items-center gap-0.5">
      <motion.div
        className="relative flex h-10 w-10 shrink-0 items-center justify-center overflow-visible rounded-full bg-white/80"
        animate={
          focusing
            ? {
                boxShadow: [
                  "0 0 0 2px rgba(255,107,136,0.35), 0 0 14px rgba(255,107,136,0.45)",
                  "0 0 0 3px rgba(255,107,136,0.55), 0 0 20px rgba(255,140,160,0.55)",
                  "0 0 0 2px rgba(255,107,136,0.35), 0 0 14px rgba(255,107,136,0.45)",
                ],
              }
            : { boxShadow: "0 0 0 2px rgba(0,0,0,0.06)" }
        }
        transition={focusing ? { duration: 2.2, repeat: Infinity, ease: "easeInOut" } : { duration: 0.3 }}
      >
        <div className="relative h-10 w-10 overflow-hidden rounded-full bg-white">
          <img
            src={avatarSrc}
            alt=""
            className="h-full w-full object-contain p-0.5"
            referrerPolicy="no-referrer"
          />
        </div>
        {unread > 0 ? (
          <motion.span
            className="pointer-events-none absolute -right-1 -top-1 flex h-[22px] w-[22px] items-center justify-center rounded-full bg-white shadow-sm ring-2 ring-rose-300/50"
            animate={{ scale: [1, 1.1, 1], opacity: [0.88, 1, 0.88] }}
            transition={{ duration: 2.2, repeat: Infinity, ease: "easeInOut" }}
            aria-hidden
          >
            <Icon name="envelope" size={12} className="text-rose-500" />
            <span className="absolute -bottom-0.5 -right-0.5 flex min-h-[14px] min-w-[14px] items-center justify-center rounded-full bg-red-500 px-0.5 text-[8px] font-bold leading-none text-white shadow-sm">
              {unread > 9 ? "9+" : unread}
            </span>
          </motion.span>
        ) : null}
      </motion.div>
      <span className="flex max-w-[88px] items-center justify-center gap-0.5 truncate text-center text-[10px] leading-tight text-muted-foreground">
        <span className="truncate">{label}</span>
        {icon ? <Icon name={icon} size={12} className="shrink-0 text-pink-500" /> : null}
      </span>
    </div>
  );
}
