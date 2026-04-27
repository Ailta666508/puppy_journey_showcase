"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Icon } from "@/components/IconManager";
import type { AchievementTask } from "./types";

type Props = {
  open: boolean;
  task: AchievementTask | null;
  onClose: () => void;
  onStartFocus: () => void | Promise<void>;
};

/**
 * 点击自己的成就卡：展开专注模式入口
 */
export function FocusModeModal({ open, task, onClose, onStartFocus }: Props) {
  return (
    <AnimatePresence>
      {open && task ? (
        <>
          <motion.button
            type="button"
            className="fixed inset-0 z-[80] bg-black/45 backdrop-blur-sm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            aria-label="关闭"
          />
          <motion.div
            role="dialog"
            className="fixed left-1/2 top-1/2 z-[90] w-[min(92vw,380px)] -translate-x-1/2 -translate-y-1/2 rounded-3xl border bg-card p-6 shadow-2xl"
            initial={{ opacity: 0, scale: 0.92 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.92 }}
            transition={{ type: "spring", damping: 26, stiffness: 320 }}
          >
            <div className="flex items-start gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10">
                <Icon name="target" className="text-primary" size={28} />
              </div>
              <div className="min-w-0 flex-1">
                <h3 className="font-semibold leading-tight">进入专注</h3>
                <p className="mt-2 text-sm text-muted-foreground">{task.title}</p>
              </div>
              <button type="button" className="rounded-lg p-1 text-muted-foreground hover:bg-muted" onClick={onClose} aria-label="关闭">
                <Icon name="close" size={20} />
              </button>
            </div>
            <button
              type="button"
              className="mt-6 flex w-full items-center justify-center gap-2 rounded-2xl py-3.5 text-base font-semibold text-white pj-btn-gradient"
              onClick={() => {
                void (async () => {
                  await Promise.resolve(onStartFocus());
                  onClose();
                })();
              }}
            >
              <span>🎯</span> 开始专注
            </button>
          </motion.div>
        </>
      ) : null}
    </AnimatePresence>
  );
}
