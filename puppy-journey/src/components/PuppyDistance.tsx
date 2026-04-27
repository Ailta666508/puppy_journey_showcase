"use client";

import confetti from "canvas-confetti";
import { motion, useMotionValue, useSpring, useTransform } from "framer-motion";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";

import { BondProgressBar } from "@/components/BondProgressBar";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { useAppStore, type AppState } from "@/store/useAppStore";

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function pointsToDistance(points: number) {
  const p = clamp(points, 0, 600);
  return 1 - p / 600;
}

function fireFullScreenConfetti() {
  const duration = 2.8;
  const end = Date.now() + duration * 1000;
  const colors = ["#fb7185", "#f472b6", "#fcd34d", "#a78bfa", "#38bdf8"];

  (function frame() {
    confetti({
      particleCount: 4,
      angle: 60,
      spread: 55,
      origin: { x: 0, y: 0.65 },
      colors,
    });
    confetti({
      particleCount: 4,
      angle: 120,
      spread: 55,
      origin: { x: 1, y: 0.65 },
      colors,
    });
    if (Date.now() < end) requestAnimationFrame(frame);
  })();

  confetti({ particleCount: 120, spread: 100, origin: { y: 0.55 }, colors, scalar: 1.05 });
}

type EditKind = "next_meeting" | "end_separation" | null;

export function PuppyDistance(props: { className?: string }) {
  const bondTargetNextMeeting = useAppStore((s: AppState) => s.bondTargetNextMeeting);
  const bondTargetEndSeparation = useAppStore((s: AppState) => s.bondTargetEndSeparation);
  const loadBondSettings = useAppStore((s: AppState) => s.loadBondSettings);
  const saveBondSettings = useAppStore((s: AppState) => s.saveBondSettings);
  const currentUserRole = useAppStore((s: AppState) => s.currentUserRole);

  const [achievementScoreSum, setAchievementScoreSum] = useState(0);
  const [stickers, setStickers] = useState(false);
  const [showHearts, setShowHearts] = useState(false);
  const [editKind, setEditKind] = useState<EditKind>(null);
  const [draftTotal, setDraftTotal] = useState("");

  const nextRatio = bondTargetNextMeeting > 0 ? achievementScoreSum / bondTargetNextMeeting : 0;
  const endRatio = bondTargetEndSeparation > 0 ? achievementScoreSum / bondTargetEndSeparation : 0;

  const combinedProgress = useMemo(() => {
    if (bondTargetNextMeeting > 0 && bondTargetEndSeparation > 0) {
      return (clamp(nextRatio, 0, 1) + clamp(endRatio, 0, 1)) / 2;
    }
    if (bondTargetNextMeeting > 0) return clamp(nextRatio, 0, 1);
    if (bondTargetEndSeparation > 0) return clamp(endRatio, 0, 1);
    return 0;
  }, [bondTargetNextMeeting, bondTargetEndSeparation, nextRatio, endRatio]);

  const pointsEquivalent = combinedProgress * 600;
  const progress = useMemo(() => 1 - pointsToDistance(pointsEquivalent), [pointsEquivalent]);

  const mv = useMotionValue(progress);
  const spring = useSpring(mv, { stiffness: 220, damping: 24, mass: 0.9 });
  const cuddle = stickers ? 14 : 0;
  const leftX = useTransform(spring, (t) => -160 + t * 140 + cuddle);
  const rightX = useTransform(spring, (t) => 160 - t * 140 - cuddle);

  useEffect(() => {
    mv.set(progress);
  }, [mv, progress]);

  const refreshBond = useCallback(async () => {
    try {
      const { achievementAuthHeaders } = await import("@/lib/achievements/clientAuth");
      const res = await fetch("/api/achievements/bond-summary", {
        cache: "no-store",
        headers: { ...(await achievementAuthHeaders()) },
      });
      const data = (await res.json()) as { ok?: boolean; achievementScoreSum?: number };
      if (data.ok) {
        setAchievementScoreSum(Math.max(0, Math.floor(data.achievementScoreSum ?? 0)));
      }
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    void loadBondSettings();
  }, [loadBondSettings, currentUserRole]);

  useEffect(() => {
    void refreshBond();
    const id = setInterval(() => void refreshBond(), 8000);
    const onVis = () => {
      if (document.visibilityState === "visible") void refreshBond();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [refreshBond]);

  const prevNextPct = useRef(0);
  const prevEndPct = useRef(0);

  const nextPct = bondTargetNextMeeting > 0 ? clamp(nextRatio, 0, 1) : 0;
  const endPct = bondTargetEndSeparation > 0 ? clamp(endRatio, 0, 1) : 0;

  useEffect(() => {
    let hit = false;
    if (bondTargetNextMeeting > 0 && nextPct >= 1 && prevNextPct.current < 1) hit = true;
    if (bondTargetEndSeparation > 0 && endPct >= 1 && prevEndPct.current < 1) hit = true;
    prevNextPct.current = nextPct;
    prevEndPct.current = endPct;
    if (hit) {
      fireFullScreenConfetti();
      setShowHearts(true);
      setStickers(true);
      const t = window.setTimeout(() => setShowHearts(false), 4200);
      const t2 = window.setTimeout(() => setStickers(false), 3200);
      return () => {
        window.clearTimeout(t);
        window.clearTimeout(t2);
      };
    }
    return undefined;
  }, [nextPct, endPct, bondTargetNextMeeting, bondTargetEndSeparation]);

  function openEdit(kind: Exclude<EditKind, null>) {
    setEditKind(kind);
    setDraftTotal(String(kind === "next_meeting" ? bondTargetNextMeeting : bondTargetEndSeparation));
  }

  async function saveTotal() {
    const n = Math.floor(Number(draftTotal));
    if (!Number.isFinite(n) || n < 1) return;
    try {
      if (editKind === "next_meeting") {
        await saveBondSettings(n, bondTargetEndSeparation);
      } else if (editKind === "end_separation") {
        await saveBondSettings(bondTargetNextMeeting, n);
      }
      setEditKind(null);
    } catch {
      /* 可后续加 toast */
    }
  }

  return (
    <Card className={cn("pj-card relative overflow-hidden p-6 sm:p-8", props.className)}>
      <div className="flex flex-col gap-1">
        <div className="text-xs font-medium text-muted-foreground">羁绊进程</div>
        <div className="text-lg font-semibold tracking-tight">下一次见面 · 结束分离状态</div>
        <p className="mt-1 text-sm text-muted-foreground">
          得分来自成就页累加规则分；请在下方分别设置两条进度的目标总分。
        </p>
      </div>

      <div className="mt-6 space-y-5">
        <BondProgressBar
          label="下一次见面"
          value={achievementScoreSum}
          max={bondTargetNextMeeting}
          action={
            <Button type="button" variant="outline" size="sm" className="h-7 text-xs" onClick={() => openEdit("next_meeting")}>
              设置总分
            </Button>
          }
        />
        <BondProgressBar
          label="结束分离状态"
          value={achievementScoreSum}
          max={bondTargetEndSeparation}
          action={
            <Button type="button" variant="outline" size="sm" className="h-7 text-xs" onClick={() => openEdit("end_separation")}>
              设置总分
            </Button>
          }
        />
      </div>

      <Dialog open={editKind !== null} onOpenChange={(o) => !o && setEditKind(null)}>
        <DialogContent className="sm:max-w-sm" showCloseButton>
          <DialogHeader>
            <DialogTitle>{editKind === "end_separation" ? "结束分离状态" : "下一次见面"} · 目标总分</DialogTitle>
            <DialogDescription>填写这条进度条满格时的目标分值（正整数）。</DialogDescription>
          </DialogHeader>
          <div className="grid gap-2 py-2">
            <Label htmlFor="bond-total">目标总分</Label>
            <Input
              id="bond-total"
              inputMode="numeric"
              value={draftTotal}
              onChange={(e) => setDraftTotal(e.target.value)}
              placeholder="例如 200"
            />
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button type="button" variant="secondary" onClick={() => setEditKind(null)}>
              取消
            </Button>
            <Button type="button" className="pj-btn-gradient text-white" onClick={saveTotal}>
              保存
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <div className="relative mt-8 h-[160px] rounded-2xl border bg-muted/25">
        <div className="absolute inset-x-5 top-8 h-px bg-border/60" />
        <div className="absolute left-5 top-6 text-xs text-muted-foreground">远</div>
        <div className="absolute right-5 top-6 text-xs text-muted-foreground">近</div>

        {showHearts ? (
          <div className="pointer-events-none absolute inset-0 z-20 flex justify-center pt-2">
            {[0, 1, 2].map((i) => (
              <motion.span
                key={i}
                className="absolute text-2xl"
                style={{ left: `calc(50% + ${(i - 1) * 36}px)` }}
                initial={{ y: 10, opacity: 0, scale: 0.6 }}
                animate={{
                  y: [-4, -28, -12],
                  opacity: [0, 1, 0.95, 0],
                  scale: [0.7, 1.15, 1],
                  rotate: [0, i % 2 === 0 ? -12 : 12, 0],
                }}
                transition={{ duration: 2.2, repeat: Infinity, delay: i * 0.25, ease: "easeInOut" }}
              >
                ❤️
              </motion.span>
            ))}
          </div>
        ) : null}

        <motion.div
          className="absolute left-1/2 top-1/2 -translate-y-1/2"
          style={{ x: leftX }}
          animate={{ scale: stickers ? 1.08 : 1 }}
          transition={{ type: "spring", stiffness: 360, damping: 20 }}
        >
          <div className="grid h-16 w-16 place-items-center rounded-2xl bg-background shadow-sm">
            <div className="relative h-14 w-14">
              <Image src="/assets/dogs/yellow.png" alt="yellow puppy" fill className="object-contain" />
            </div>
          </div>
        </motion.div>

        <motion.div
          className="absolute left-1/2 top-1/2 -translate-y-1/2"
          style={{ x: rightX }}
          animate={{ scale: stickers ? 1.08 : 1 }}
          transition={{ type: "spring", stiffness: 360, damping: 20 }}
        >
          <div className="grid h-16 w-16 place-items-center rounded-2xl bg-background shadow-sm">
            <div className="relative h-14 w-14">
              <Image src="/assets/dogs/white.png" alt="white puppy" fill className="object-contain" />
            </div>
          </div>
        </motion.div>
      </div>
    </Card>
  );
}
