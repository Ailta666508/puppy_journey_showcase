"use client";

import { motion } from "framer-motion";
import { Icon } from "@/components/IconManager";
import { achievementPrimaryCircularFabClasses } from "@/lib/achievementPrimaryAction";

type Props = {
  onClick: () => void;
  /** 按钮下方提示文案 */
  hint?: string;
};

/** 底部居中悬浮 + 按钮 */
export function FloatingActionButton({ onClick, hint }: Props) {
  return (
    <div className="pointer-events-none fixed bottom-6 left-0 right-0 z-40 flex flex-col items-center gap-2 px-4">
      <motion.button
        type="button"
        whileHover={{ scale: 1.06 }}
        whileTap={{ scale: 0.95 }}
        onClick={onClick}
        className={achievementPrimaryCircularFabClasses("pointer-events-auto")}
        aria-label="添加新任务"
      >
        <Icon name="plus" className="text-white" size={28} />
      </motion.button>
      {hint ? <p className="max-w-[min(100%,280px)] text-center text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}
