"use client";

import Link from "next/link";
import { TopNav } from "@/components/TopNav";
import { WishNewTimelineForm } from "@/components/wishes/WishNewTimelineForm";

/** 添加心愿：右侧时间轴同款 UI 的表单页 */
export default function WishNewPage() {
  return (
    <div className="min-h-screen bg-background">
      <TopNav />
      <main className="mx-auto w-full max-w-6xl px-4 py-8 sm:py-10">
        <div className="mb-6 flex flex-wrap items-center gap-3">
          <Link
            href="/wishes"
            className="text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
          >
            ← 返回心愿墙
          </Link>
        </div>

        <div className="mb-4">
          <div className="text-sm text-muted-foreground">Wish Wall</div>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight sm:text-3xl">添加心愿</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            「日期」「旅行随笔」与旅行页新增记录字段一致；保存后出现在心愿墙列表最上方，达成后会在地图对应城市展示相同字段名。
          </p>
        </div>

        <section className="mx-auto max-w-xl">
          <h2 className="mb-3 text-sm font-medium text-muted-foreground">许愿瓶</h2>
          <div className="glass-panel rounded-3xl p-4 sm:p-5">
            <WishNewTimelineForm />
          </div>
        </section>
      </main>
    </div>
  );
}
