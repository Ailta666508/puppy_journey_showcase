"use client";

import Link from "next/link";
import { Plus } from "lucide-react";
import { achievementPrimaryCircularFabClasses } from "@/lib/achievementPrimaryAction";
import { cn } from "@/lib/utils";
import type { WishItem } from "@/store/useAppStore";
import { WishCard } from "./WishCard";

type Props = {
  wishes: WishItem[];
  isDemo?: boolean;
  /** 非演示且列表为空：通常表示心愿已全部达成并从列表移除 */
  allCompleted?: boolean;
  className?: string;
  onCompleteWish: (wishId: string) => Promise<void>;
  onDeleteWish?: (wishId: string) => void;
};

/**
 * 心愿墙右侧：竖条时间轴 + 马卡龙 WishCard 流式列表
 */
export function WishTimelineStream({
  wishes,
  isDemo,
  allCompleted,
  className,
  onCompleteWish,
  onDeleteWish,
}: Props) {
  return (
    <div className={cn("relative", className)}>
      {isDemo ? (
        <p className="mb-3 rounded-xl bg-muted/50 px-3 py-2 text-center text-xs text-muted-foreground">
          以下为示例心愿 · 添加自己的心愿后可点「标记已实现」
        </p>
      ) : null}

      {!isDemo && allCompleted ? (
        <p className="mb-3 rounded-xl bg-primary/10 px-3 py-2 text-center text-xs text-muted-foreground">
          进行中的心愿已全部达成。列表中已隐藏；地图上会点亮「想去的地方」对应城市，悬停可查看日期与旅行随笔。
        </p>
      ) : null}

      <div className="flex flex-col gap-0">
        {wishes.map((item, i) => {
          const isLast = i === wishes.length - 1;
          return (
            <WishCard
              key={item.id}
              item={item}
              showConnectorBelow={!isLast}
              tiltNote={isLast}
              disableComplete={isDemo}
              onDeleteWish={isDemo ? undefined : onDeleteWish}
              onCompleteWish={onCompleteWish}
            />
          );
        })}
      </div>

      {wishes.length === 0 && !allCompleted ? (
        <p className="mt-4 text-center text-sm text-muted-foreground">还没有心愿</p>
      ) : null}

      <div className="mt-2 flex flex-col items-center gap-3 sm:mt-4">
        <Link
          href="/wishes/new"
          className={achievementPrimaryCircularFabClasses("transition hover:scale-105 hover:shadow-xl active:scale-95")}
          aria-label="添加心愿"
        >
          <Plus className="h-7 w-7" strokeWidth={2.5} />
        </Link>
        <span className="text-xs text-muted-foreground">添加心愿</span>
      </div>
    </div>
  );
}
