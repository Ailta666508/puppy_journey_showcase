"use client";

import { useEffect } from "react";
import confetti from "canvas-confetti";
import { AnimatePresence, motion } from "framer-motion";
import { Icon } from "@/components/IconManager";
import type { VoucherType } from "./types";
import { VOUCHER_ICON_NAMES, VOUCHER_LABELS } from "./types";

type Props = {
  open: boolean;
  voucher: VoucherType | null;
  onClose: () => void;
};

/**
 * 拆盲盒全屏：彩纸屑 + 卡片翻转 + 兑换券展示 + 音频占位
 */
export function UnboxModal({ open, voucher, onClose }: Props) {
  useEffect(() => {
    if (!open || !voucher) return;
    const t = setTimeout(() => {
      confetti({
        particleCount: 120,
        spread: 85,
        origin: { y: 0.55 },
        colors: ["#ff6b88", "#c9beff", "#ffdbfd", "#ffd93d"],
      });
    }, 200);
    return () => clearTimeout(t);
  }, [open, voucher]);

  const iconName = voucher ? VOUCHER_ICON_NAMES[voucher] : "gift";

  return (
    <AnimatePresence>
      {open && voucher ? (
        <>
          <motion.div
            className="fixed inset-0 z-[100] bg-black/70 backdrop-blur-md"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />
          <div className="pointer-events-none fixed inset-0 z-[101] flex items-center justify-center p-4">
            <motion.div
              className="pointer-events-auto w-full max-w-sm perspective-[1000px]"
              initial={{ scale: 0.85, rotateY: -90, opacity: 0 }}
              animate={{ scale: 1, rotateY: 0, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              transition={{ type: "spring", damping: 22, stiffness: 280 }}
              style={{ transformStyle: "preserve-3d" }}
            >
              <div className="rounded-3xl border-2 border-primary/30 bg-gradient-to-br from-card to-primary/5 p-6 shadow-2xl">
                <div className="flex flex-col items-center text-center">
                  <motion.div
                    initial={{ scale: 0.5, rotate: -12 }}
                    animate={{ scale: 1, rotate: 0 }}
                    transition={{ delay: 0.15, type: "spring" }}
                    className="mb-4 flex h-24 w-24 items-center justify-center rounded-3xl bg-primary/15"
                  >
                    <Icon name={iconName} size={56} className="text-primary" />
                  </motion.div>
                  <p className="text-xs font-medium text-muted-foreground">恭喜拆出</p>
                  <h3 className="mt-1 text-xl font-bold">{VOUCHER_LABELS[voucher]}</h3>
                </div>

                {/* 语音占位：波形 + 播放 */}
                <div className="mt-6 rounded-2xl border border-dashed border-border bg-muted/40 p-4">
                  <p className="mb-2 text-center text-[10px] text-muted-foreground">Ta 的语音祝福</p>
                  <div className="flex h-10 items-end justify-center gap-0.5">
                    {[4, 7, 5, 9, 6, 8, 5, 7, 4].map((h, i) => (
                      <motion.span
                        key={i}
                        className="w-1 rounded-full bg-primary/60"
                        style={{ height: `${h * 3}px` }}
                        animate={{ scaleY: [1, 1.4, 1] }}
                        transition={{ duration: 0.8, repeat: Infinity, delay: i * 0.08 }}
                      />
                    ))}
                  </div>
                  <button
                    type="button"
                    className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl bg-background py-2 text-sm font-medium shadow-sm"
                  >
                    <Icon name="play" size={18} />
                    播放（占位）
                  </button>
                </div>

                <button
                  type="button"
                  className="mt-5 w-full rounded-2xl border py-3 text-sm font-medium"
                  onClick={onClose}
                >
                  收下啦
                </button>
              </div>
            </motion.div>
          </div>
        </>
      ) : null}
    </AnimatePresence>
  );
}
