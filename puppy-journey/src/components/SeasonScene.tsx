"use client";

import { useMemo } from "react";
import { motion } from "framer-motion";
import Image from "next/image";

import { cn } from "@/lib/utils";

type Season = "spring" | "summer" | "autumn" | "winter";

function getSeasonByMonth(month: number): Season {
  if (month >= 3 && month <= 5) return "spring";
  if (month >= 6 && month <= 8) return "summer";
  if (month >= 9 && month <= 11) return "autumn";
  return "winter";
}

function seasonLabel(season: Season) {
  switch (season) {
    case "spring":
      return "春";
    case "summer":
      return "夏";
    case "autumn":
      return "秋";
    case "winter":
      return "冬";
  }
}

function seasonGradient(season: Season) {
  switch (season) {
    case "spring":
      return "from-emerald-50 via-sky-50 to-rose-50 dark:from-emerald-950/40 dark:via-sky-950/40 dark:to-rose-950/30";
    case "summer":
      return "from-sky-50 via-amber-50 to-lime-50 dark:from-sky-950/40 dark:via-amber-950/30 dark:to-lime-950/30";
    case "autumn":
      return "from-orange-50 via-amber-50 to-red-50 dark:from-orange-950/40 dark:via-amber-950/30 dark:to-red-950/30";
    case "winter":
      return "from-slate-50 via-sky-50 to-indigo-50 dark:from-slate-950/50 dark:via-sky-950/40 dark:to-indigo-950/30";
  }
}

export function SeasonScene(props: { className?: string }) {
  const season = useMemo(() => getSeasonByMonth(new Date().getMonth() + 1), []);

  return (
    <div className={cn("pj-card relative overflow-hidden", props.className)}>
      {/* Backdrop: fill container softly */}
      <Image
        src="/assets/bg/scene-today.png"
        alt=""
        fill
        priority
        className="object-cover opacity-35 blur-[2px] saturate-[0.95] scale-[1.03]"
      />
      {/* Foreground: keep key elements fully visible */}
      <div className="absolute inset-0 p-4 sm:p-5">
        <div className="relative h-full w-full">
          <Image
            src="/assets/bg/scene-today.png"
            alt="today scene"
            fill
            className="object-contain"
            sizes="(min-width: 1024px) 50vw, 100vw"
          />
        </div>
      </div>

      <div className="absolute inset-0 bg-gradient-to-b from-white/0 via-white/0 to-white/40 dark:to-black/20" />

      <div className="relative p-6 sm:p-8">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-xs font-medium text-muted-foreground">今日场景</div>
            <div className="mt-1 text-lg font-semibold tracking-tight">
              四季流转 · {seasonLabel(season)}季
            </div>
          </div>

          <motion.div
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35 }}
            className="rounded-full bg-background/70 px-3 py-1 text-xs text-muted-foreground backdrop-blur"
          >
            自动随月份切换
          </motion.div>
        </div>

        <div className="relative mt-6 h-[170px] sm:h-[190px]">
          <div className="absolute inset-x-6 bottom-6 h-10 rounded-full bg-background/35 blur-xl" />
          <div className="absolute inset-x-6 bottom-10 h-px bg-border/60" />
        </div>
      </div>
    </div>
  );
}

