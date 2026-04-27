"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Icon } from "@/components/IconManager";
import type { AchievementTask, VoucherType } from "./types";
import { VOUCHER_ICON_NAMES, VOUCHER_LABELS } from "./types";

const VOUCHER_ORDER: VoucherType[] = ["milktea", "film", "massage", "shield"];

type Props = {
  open: boolean;
  task: AchievementTask | null;
  onClose: () => void;
  onConfirm: (taskId: string, voucher: VoucherType) => void;
};

/**
 * 底部半屏：为对方任务挂上通关奖励（兑换券 + 语音占位）
 */
export function AddBlindBoxSheet({ open, task, onClose, onConfirm }: Props) {
  const [selected, setSelected] = useState<VoucherType>(() => task?.blindBox.voucher ?? "milktea");
  const [pressingMic, setPressingMic] = useState(false);

  if (!task && !open) return null;

  return (
    <AnimatePresence>
      {open && task ? (
        <>
          <motion.button
            type="button"
            aria-label="关闭"
            className="fixed inset-0 z-[60] bg-black/40 backdrop-blur-[2px]"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />
          <motion.div
            role="dialog"
            aria-modal
            className="fixed inset-x-0 bottom-0 z-[70] max-h-[85vh] overflow-auto rounded-t-3xl border border-border bg-card px-4 pb-8 pt-5 shadow-2xl"
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={{ type: "spring", damping: 28, stiffness: 320 }}
          >
            <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-muted" />
            <h3 className="text-center text-lg font-semibold">为他添加通关奖励🎁</h3>
            <p className="mt-1 text-center text-xs text-muted-foreground">选择一张兑换券（单选）</p>

            <div className="mt-6 flex flex-wrap justify-center gap-3">
              {VOUCHER_ORDER.map((v) => {
                const active = selected === v;
                const iconName = VOUCHER_ICON_NAMES[v];
                return (
                  <button
                    key={v}
                    type="button"
                    onClick={() => setSelected(v)}
                    className={`flex flex-col items-center gap-1 rounded-2xl border-2 px-4 py-3 transition ${
                      active
                        ? "border-primary bg-primary/10 shadow-sm"
                        : "border-border bg-background/80 hover:border-primary/40"
                    }`}
                  >
                    <Icon name={iconName} size={28} className={active ? "text-primary" : "text-muted-foreground"} />
                    <span className="text-[10px] font-medium">{VOUCHER_LABELS[v]}</span>
                  </button>
                );
              })}
            </div>

            <div className="mt-8 flex flex-col items-center gap-2">
              <p className="text-xs text-muted-foreground">按住录音（占位）</p>
              <button
                type="button"
                className={`flex h-16 w-16 items-center justify-center rounded-full border-2 transition ${
                  pressingMic ? "border-primary bg-primary/15 scale-95" : "border-dashed border-muted-foreground/40"
                }`}
                onMouseDown={() => setPressingMic(true)}
                onMouseUp={() => setPressingMic(false)}
                onMouseLeave={() => setPressingMic(false)}
                onTouchStart={() => setPressingMic(true)}
                onTouchEnd={() => setPressingMic(false)}
              >
                <Icon name="mic" size={32} className="text-muted-foreground" />
              </button>
            </div>

            <div className="mt-8 flex justify-center">
              <button
                type="button"
                className="rounded-full px-8 py-3 text-sm font-semibold text-white pj-btn-gradient shadow-md"
                onClick={() => {
                  onConfirm(task.id, selected);
                  onClose();
                }}
              >
                悄悄挂上
              </button>
            </div>
          </motion.div>
        </>
      ) : null}
    </AnimatePresence>
  );
}
