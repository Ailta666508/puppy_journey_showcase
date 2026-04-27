"use client";

import { useState } from "react";
import Image from "next/image";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Icon } from "@/components/IconManager";
import { cn } from "@/lib/utils";
import { partnerRole, ROLE_INFO } from "@/lib/userRole";
import { useAppStore, type AppState } from "@/store/useAppStore";
import type { AchievementTask } from "./types";

type Props = {
  task: AchievementTask;
  onBodyClick: () => void;
  onDelete: (taskId: string) => Promise<void>;
};

const MACARON_BG = [
  "bg-orange-50/80",
  "bg-purple-50/80",
  "bg-blue-50/80",
  "bg-rose-50/80",
] as const;

const TILT = ["-rotate-2", "-rotate-1", "rotate-0", "rotate-1", "rotate-2"] as const;

function styleSeed(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) {
    h = (h * 31 + id.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

/**
 * 手账便签卡：马卡龙底色 + 随机倾斜 + 规则分值 + 删除
 */
export function TaskCard({ task, onBodyClick, onDelete }: Props) {
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const viewer = useAppStore((s: AppState) => s.currentUserRole);

  const isPartner = task.owner === "partner";
  const showLockedGift = isPartner && task.blindBox.isAttached && !task.blindBox.isOpened;
  const showOpenGiftMine = !isPartner && task.blindBox.isAttached;

  const seed = styleSeed(task.id);
  const bgClass = MACARON_BG[seed % MACARON_BG.length];
  const tiltClass = TILT[seed % TILT.length];
  const taskUserRole = task.owner === "me" ? viewer : partnerRole(viewer);
  const stampSrc = ROLE_INFO[taskUserRole].avatarSrc;

  async function confirmDelete() {
    setDeleting(true);
    try {
      await onDelete(task.id);
      setDeleteOpen(false);
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="relative">
      <div
        role="button"
        tabIndex={0}
        onClick={onBodyClick}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onBodyClick();
          }
        }}
        className={cn(
          "relative cursor-pointer rounded-2xl border border-white/60 p-4 pb-14 pl-4 pr-10 pt-10 shadow-sm transition-transform duration-200 will-change-transform",
          "hover:z-10 hover:scale-105 hover:shadow-md",
          bgClass,
          tiltClass,
        )}
      >
        {showLockedGift ? (
          <div className="absolute right-2 top-2 z-[1] drop-shadow-[0_0_6px_rgba(255,107,136,0.55)]">
            <Icon name="giftLocked" size={22} />
          </div>
        ) : null}
        {showOpenGiftMine ? (
          <div className="absolute right-2 top-2 z-[1]">
            <Icon name="giftOpenPartner" size={22} />
          </div>
        ) : null}

        <div className="relative min-w-0 pr-2">
          <p className="text-sm font-semibold leading-snug text-stone-800">{task.title}</p>
          <span className="mt-2 inline-block rounded-full bg-amber-100/90 px-2 py-0.5 text-[10px] font-semibold text-amber-900/90 shadow-sm">
            +{task.score ?? 5} 分
          </span>
        </div>

        <div className="pointer-events-none absolute bottom-3 right-3 z-[1]">
          <Image
            src={stampSrc}
            alt=""
            width={32}
            height={32}
            className="h-8 w-8 rounded-full border-2 border-white object-cover shadow-sm"
            unoptimized
          />
        </div>
      </div>

      <button
        type="button"
        aria-label="删除成就"
        className="absolute left-2 top-2 z-[15] flex h-8 w-8 items-center justify-center rounded-full border border-stone-200/90 bg-white/90 text-muted-foreground shadow-sm transition hover:border-destructive/40 hover:bg-destructive/10 hover:text-destructive"
        onClick={(e) => {
          e.stopPropagation();
          setDeleteOpen(true);
        }}
      >
        <Icon name="trash" size={16} />
      </button>

      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent className="sm:max-w-sm" showCloseButton>
          <DialogHeader>
            <DialogTitle>删除成就</DialogTitle>
            <DialogDescription>确定删除「{task.title}」？删除后主页羁绊分将重新累计（刷新或稍后同步）。</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="outline" onClick={() => setDeleteOpen(false)} disabled={deleting}>
              取消
            </Button>
            <Button type="button" variant="destructive" disabled={deleting} onClick={() => void confirmDelete()}>
              {deleting ? "删除中…" : "删除"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
