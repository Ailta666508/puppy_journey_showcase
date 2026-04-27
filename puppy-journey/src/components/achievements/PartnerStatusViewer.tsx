"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Icon } from "@/components/IconManager";
import type { IconName } from "@/components/IconManager";
import { Button } from "@/components/ui/button";
import { type UserStatusPair, effectivePresenceFocusing } from "./types";
type Props = {
  open: boolean;
  presence: UserStatusPair;
  onClose: () => void;
  onPresenceUpdate: (next: UserStatusPair) => void;
};

const QUICK_EMOJIS: { label: string; emoji: string }[] = [
  { label: "抱抱", emoji: "🫂" },
  { label: "贴贴", emoji: "💕" },
  { label: "蹭蹭", emoji: "✨" },
  { label: "摸摸头", emoji: "🐾" },
];

/** 只读小纸条：展示对方状态与悄悄话正文；打开时仅标记悄悄话已读（不动状态字段） */
export function PartnerStatusViewer({ open, presence, onClose, onPresenceUpdate }: Props) {
  const [tip, setTip] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setTip(null);
    let cancelled = false;
    void (async () => {
      const { achievementAuthHeaders } = await import("@/lib/achievements/clientAuth");
      const r = await fetch("/api/achievements/whisper/read", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await achievementAuthHeaders()) },
        body: JSON.stringify({ roles: ["me"] }),
      });
      const d = (await r.json()) as { ok?: boolean; presence?: UserStatusPair };
      if (!cancelled && d.ok && d.presence) onPresenceUpdate(d.presence);
    })();
    return () => {
      cancelled = true;
    };
  }, [open, onPresenceUpdate]);

  const p = presence.partner;
  const focusing = effectivePresenceFocusing(p);
  const statusLabel = focusing ? "专注中 🤫" : p.statusText;
  const statusIcon = focusing ? null : ((p.statusIcon as IconName | null) ?? null);
  /** 对方发给你 → 记在「我」槽位 */
  const whisperFromPartner = presence.me.lastWhisperReceived?.trim();
  /** 你发给对方 → 记在「对方」槽位（仅对方头像未读时也可在此回看） */
  const whisperYouSent = presence.partner.lastWhisperReceived?.trim();

  return (
    <AnimatePresence>
      {open ? (
        <>
          <motion.button
            type="button"
            className="fixed inset-0 z-[95] bg-black/45 backdrop-blur-[2px]"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            aria-label="关闭"
          />
          <motion.div
            role="dialog"
            className="fixed left-1/2 top-1/2 z-[100] w-[min(92vw,400px)] -translate-x-1/2 -translate-y-1/2"
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.96 }}
            transition={{ type: "spring", damping: 26, stiffness: 320 }}
          >
            <div
              className="relative overflow-hidden rounded-2xl border border-amber-100/80 bg-[#FFFBF5] shadow-md"
              style={{
                boxShadow: "0 12px 40px -12px rgba(180, 120, 80, 0.25), 0 4px 16px -4px rgba(0,0,0,0.08)",
              }}
            >
              {/* 折痕 */}
              <div
                className="pointer-events-none absolute inset-y-8 left-1/2 w-px -translate-x-1/2 bg-gradient-to-b from-transparent via-amber-200/60 to-transparent opacity-70"
                aria-hidden
              />
              <div className="relative px-6 pb-5 pt-6">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-base font-semibold text-amber-950/90">Ta 的小纸条</h3>
                  <button
                    type="button"
                    className="rounded-lg p-1 text-muted-foreground transition hover:bg-amber-100/80"
                    onClick={onClose}
                    aria-label="关闭"
                  >
                    <Icon name="close" size={20} />
                  </button>
                </div>
                <p className="mt-1 text-xs text-amber-900/50">只读 · 看看 Ta 现在的状态</p>

                <div className="mt-5 rounded-xl border border-amber-100/90 bg-white/60 px-4 py-3">
                  <p className="text-[10px] font-medium uppercase tracking-wider text-amber-800/50">当前状态</p>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <span className="text-lg font-medium text-amber-950">{statusLabel}</span>
                    {statusIcon ? <Icon name={statusIcon} size={22} className="text-pink-500" /> : null}
                  </div>
                </div>

                {whisperFromPartner ? (
                  <div className="mt-4 rounded-xl border border-rose-100/90 bg-rose-50/50 px-4 py-3">
                    <p className="text-[10px] font-medium text-rose-800/60">Ta 留给你的悄悄话</p>
                    <p
                      className="mt-2 text-lg leading-relaxed text-rose-950/90"
                      style={{ fontFamily: "var(--font-hand, 'Comic Sans MS', 'Segoe Print', cursive)" }}
                    >
                      {whisperFromPartner}
                    </p>
                  </div>
                ) : null}

                {whisperYouSent ? (
                  <div className="mt-3 rounded-xl border border-amber-100/90 bg-amber-50/40 px-4 py-3">
                    <p className="text-[10px] font-medium text-amber-800/55">你写给 Ta 的悄悄话</p>
                    <p
                      className="mt-2 text-lg leading-relaxed text-amber-950/85"
                      style={{ fontFamily: "var(--font-hand, 'Comic Sans MS', 'Segoe Print', cursive)" }}
                    >
                      {whisperYouSent}
                    </p>
                  </div>
                ) : null}

                {!whisperFromPartner && !whisperYouSent ? (
                  <p className="mt-4 text-center text-sm text-amber-900/40">暂无悄悄话，去我的头像里写一句吧～</p>
                ) : null}

                <div className="mt-5 border-t border-amber-100/80 pt-4">
                  <p className="mb-2 text-center text-[10px] text-amber-800/50">轻轻互动一下</p>
                  <div className="flex flex-wrap justify-center gap-2">
                    {QUICK_EMOJIS.map((x) => (
                      <Button
                        key={x.emoji}
                        type="button"
                        variant="secondary"
                        size="sm"
                        className="rounded-full border-amber-100 bg-white/80 text-amber-900 hover:bg-amber-50"
                        onClick={() => {
                          setTip(`「${x.label}」已传给 Ta～（占位）`);
                          window.setTimeout(() => setTip(null), 2200);
                        }}
                      >
                        {x.label} {x.emoji}
                      </Button>
                    ))}
                  </div>
                </div>

                <AnimatePresence>
                  {tip ? (
                    <motion.p
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0 }}
                      className="mt-3 text-center text-xs text-amber-800/80"
                    >
                      {tip}
                    </motion.p>
                  ) : null}
                </AnimatePresence>
              </div>
            </div>
          </motion.div>
        </>
      ) : null}
    </AnimatePresence>
  );
}
