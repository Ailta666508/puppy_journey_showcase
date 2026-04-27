"use client";

import type { ReactNode } from "react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";

type Props = {
  label: string;
  /** 分子：成就累加分 */
  value: number;
  /** 分母：用户在主页设置的总分；0 时进度为 0 */
  max: number;
  /** 例如「设置总分」按钮 */
  action?: ReactNode;
  className?: string;
};

export function BondProgressBar({ label, value, max, action, className }: Props) {
  const safeMax = Math.max(0, max);
  const pct = safeMax > 0 ? Math.min(100, (Math.max(0, value) / safeMax) * 100) : 0;
  const isFull = safeMax > 0 && value >= safeMax;

  return (
    <div className={cn("space-y-2", className)}>
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
        <span className="font-medium text-foreground">{label}</span>
        <div className="flex flex-wrap items-center gap-2">
          {action}
          <span className="tabular-nums text-muted-foreground">
            {safeMax > 0 ? (
              <>
                {Math.floor(value)} / {Math.floor(safeMax)}
                {isFull ? <span className="ml-1.5 text-primary">· 已满</span> : null}
              </>
            ) : (
              <span>请先设置目标总分</span>
            )}
          </span>
        </div>
      </div>
      <div className="h-2.5 overflow-hidden rounded-full bg-muted/80 ring-1 ring-border/40">
        <motion.div
          className={cn(
            "h-full rounded-full bg-gradient-to-r from-pink-400 via-rose-400 to-amber-300",
            isFull && "shadow-[0_0_12px_rgba(251,113,133,0.55)]",
          )}
          initial={false}
          animate={{ width: `${pct}%` }}
          transition={{ type: "spring", stiffness: 120, damping: 22, mass: 0.85 }}
        />
      </div>
    </div>
  );
}
