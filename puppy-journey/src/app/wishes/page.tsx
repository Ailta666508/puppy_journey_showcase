"use client";

import { useCallback, useEffect, useMemo } from "react";
import dynamic from "next/dynamic";
import { TopNav } from "@/components/TopNav";
import { DEMO_WISHES } from "@/components/wishes/demoWishes";
import { WishTimelineStream } from "@/components/wishes/WishTimelineStream";
import { useAppStore, type AppState } from "@/store/useAppStore";
import type { WishItem } from "@/store/useAppStore";

const ChinaMapTravel = dynamic(
  () => import("@/components/ChinaMapTravel").then((m) => m.ChinaMapTravel),
  { ssr: false },
);

function useWishesList(): { list: WishItem[]; isDemo: boolean } {
  const wishes = useAppStore((s: AppState) => s.wishes);
  const fetchWishes = useAppStore((s: AppState) => s.fetchWishes);
  const currentUserRole = useAppStore((s: AppState) => s.currentUserRole);

  useEffect(() => {
    void fetchWishes();
  }, [fetchWishes, currentUserRole]);

  return useMemo(() => {
    if (wishes.length === 0) {
      return { list: DEMO_WISHES, isDemo: true };
    }
    const sorted = [...wishes].sort((a, b) => {
      const byDate = b.wishDate.localeCompare(a.wishDate);
      if (byDate !== 0) return byDate;
      return b.createdAt.localeCompare(a.createdAt);
    });
    return { list: sorted, isDemo: false };
  }, [wishes]);
}

export default function WishesPage() {
  const currentUserRole = useAppStore((s: AppState) => s.currentUserRole);
  const storeWishes = useAppStore((s: AppState) => s.wishes);
  const completeWish = useAppStore((s: AppState) => s.completeWish);
  const removeWish = useAppStore((s: AppState) => s.removeWish);
  const { list, isDemo } = useWishesList();

  const timelineWishes = useMemo(() => {
    if (isDemo) return list;
    return list.filter((w) => !w.isCompleted);
  }, [isDemo, list]);

  const completedWishesForMap = useMemo(
    () => storeWishes.filter((w) => w.isCompleted),
    [storeWishes],
  );

  const allCompleted = !isDemo && storeWishes.length > 0 && timelineWishes.length === 0;

  /** 标记已实现：WishCard 内短暂 loading */
  const handleCompleteWish = useCallback(
    async (wishId: string) => {
      await completeWish(wishId);
    },
    [completeWish],
  );

  return (
    <div className="min-h-screen bg-background">
      <TopNav />
      <main className="mx-auto w-full max-w-6xl px-4 py-8 sm:py-10">
        <div className="mb-6">
          <div className="text-sm text-muted-foreground">Wish Wall</div>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight">心愿墙</h1>
          <p className="mt-1 text-muted-foreground">
            旅行日志与已点亮城市的心愿都会在地图上汇合；悬停城市统一展示「日期」「旅行随笔」（与旅行日志、许愿瓶字段一致）。许愿瓶仅展示未完成心愿，点「标记已实现」确认后从列表移除。
          </p>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 md:gap-6">
          <section className="min-w-0 flex flex-col">
            <h2 className="mb-3 text-sm font-medium text-muted-foreground">去过的城市</h2>
            <ChinaMapTravel
              userId={currentUserRole}
              completedWishes={completedWishesForMap}
              className="w-full min-h-[280px] flex-1"
            />
          </section>

          <section className="min-w-0 flex flex-col">
            <h2 className="mb-3 text-sm font-medium text-muted-foreground">许愿瓶</h2>
            <div className="glass-panel flex-1 rounded-3xl p-4 sm:p-5">
              <WishTimelineStream
                wishes={timelineWishes}
                isDemo={isDemo}
                allCompleted={allCompleted}
                onCompleteWish={handleCompleteWish}
                onDeleteWish={removeWish}
              />
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}
