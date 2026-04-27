"use client";

import { useState } from "react";
import { AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { ROLE_INFO, isUserRole } from "@/lib/userRole";
import type { WishItem } from "@/store/useAppStore";
import {
  WISH_MACARON_BG,
  WISH_MACARON_BORDER,
  WISH_TILT,
  wishStyleSeed,
} from "@/lib/wishCardStyle";
import { WishCompletedStamp } from "./WishCompletedStamp";
import { WishDatePill } from "./WishDatePill";

function isWishFilled(item: WishItem): boolean {
  return Boolean(item.place?.trim() && item.thing?.trim());
}

type Props = {
  item: WishItem;
  showConnectorBelow?: boolean;
  tiltNote?: boolean;
  disableComplete?: boolean;
  /** 演示数据不传，不展示删除 */
  onDeleteWish?: (wishId: string) => void | Promise<void>;
  onCompleteWish: (wishId: string) => Promise<void>;
};

/**
 * 心愿马卡龙卡片：日期胶囊 + 想去的地方 / 旅行随笔；按钮标记已实现
 */
export function WishCard({
  item,
  showConnectorBelow,
  tiltNote,
  disableComplete,
  onDeleteWish,
  onCompleteWish,
}: Props) {
  const [loading, setLoading] = useState(false);
  const [fulfillOpen, setFulfillOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const seed = wishStyleSeed(item.id);
  const bg = WISH_MACARON_BG[seed % WISH_MACARON_BG.length]!;
  const border = WISH_MACARON_BORDER[seed % WISH_MACARON_BORDER.length]!;
  const tilt = WISH_TILT[seed % WISH_TILT.length]!;
  const done = item.isCompleted;
  const filled = isWishFilled(item);
  const isOwnWish = disableComplete ? false : item.mine === true;
  const canMarkComplete = isOwnWish && !done && filled;

  async function confirmComplete() {
    if (done || disableComplete || loading) return;
    setLoading(true);
    try {
      await onCompleteWish(item.id);
      setFulfillOpen(false);
    } finally {
      setLoading(false);
    }
  }

  const showDelete = Boolean(onDeleteWish) && isOwnWish;

  async function confirmDelete() {
    if (!onDeleteWish || deleting) return;
    setDeleting(true);
    try {
      await onDeleteWish(item.id);
      setDeleteOpen(false);
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="flex gap-3 sm:gap-4">
      <WishDatePill wishDate={item.wishDate} colorSeed={item.id} showConnectorBelow={showConnectorBelow} />

      <div className={cn("min-w-0 flex-1 pb-8", tiltNote && "sm:pb-10")}>
        <div
          className={cn(
            "group relative overflow-hidden rounded-2xl border p-4 shadow-sm transition-all duration-300 sm:p-5",
            border,
            bg,
            tiltNote ? tilt : "",
            "hover:shadow-md",
            done && "opacity-70",
          )}
        >
          <div className="pointer-events-none absolute inset-0 bg-white/0 transition-colors group-hover:bg-white/[0.04]" />

          {item.authorRole != null && isUserRole(item.authorRole) ? (
            <div className="relative z-0 mb-2">
              <Badge variant="secondary" className="gap-1 font-normal">
                <span aria-hidden>{ROLE_INFO[item.authorRole].emoji}</span>
                {ROLE_INFO[item.authorRole].label}
              </Badge>
            </div>
          ) : null}
          <ul className="relative z-0 space-y-2.5 text-sm text-foreground sm:text-[15px]">
            <li className="flex gap-2 leading-snug">
              <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-white shadow-sm ring-1 ring-black/5" />
              <span>
                <span className="font-medium text-foreground/80">想去的地方：</span>
                {item.place?.trim() || "（待补充）"}
              </span>
            </li>
            <li className="flex gap-2 leading-snug">
              <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-white shadow-sm ring-1 ring-black/5" />
              <span>
                <span className="font-medium text-foreground/80">旅行随笔：</span>
                {item.thing?.trim() || "（待补充）"}
              </span>
            </li>
          </ul>

          {canMarkComplete || showDelete ? (
            <div className="relative z-[5] mt-4 flex flex-col gap-2">
              {canMarkComplete ? (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="w-full border-primary/35 bg-white/70 text-foreground shadow-sm hover:bg-white"
                  disabled={loading}
                  onClick={(e) => {
                    e.stopPropagation();
                    setFulfillOpen(true);
                  }}
                >
                  标记已实现
                </Button>
              ) : null}
              {showDelete ? (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="w-full border-destructive/35 bg-white/70 text-destructive shadow-sm hover:bg-destructive/5"
                  disabled={deleting}
                  onClick={(e) => {
                    e.stopPropagation();
                    setDeleteOpen(true);
                  }}
                >
                  删除
                </Button>
              ) : null}
            </div>
          ) : null}

          <AnimatePresence>
            {done ? <WishCompletedStamp key={`stamp-${item.id}`} className="z-[35]" /> : null}
          </AnimatePresence>
        </div>

        <Dialog open={fulfillOpen} onOpenChange={setFulfillOpen}>
          <DialogContent className="sm:max-w-sm" showCloseButton>
            <DialogHeader>
              <DialogTitle>心愿实现</DialogTitle>
              <DialogDescription>确认将本条心愿标记为已达成？标记后会盖章。</DialogDescription>
            </DialogHeader>
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button type="button" variant="outline" onClick={() => setFulfillOpen(false)} disabled={loading}>
                取消
              </Button>
              <Button
                type="button"
                className="pj-btn-gradient text-white"
                disabled={loading}
                onClick={() => void confirmComplete()}
              >
                {loading ? "处理中…" : "确认实现"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>

        <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
          <DialogContent className="sm:max-w-sm" showCloseButton>
            <DialogHeader>
              <DialogTitle>删除心愿</DialogTitle>
              <DialogDescription>确定从许愿瓶移除这条心愿？此操作不可恢复。</DialogDescription>
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
    </div>
  );
}
