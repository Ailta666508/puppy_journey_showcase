"use client";

import { TopNav } from "@/components/TopNav";
import { PuppyDistance } from "@/components/PuppyDistance";
import { SeasonScene } from "@/components/SeasonScene";

export default function MainPage() {
  return (
    <div className="min-h-screen bg-background">
      <TopNav />
      <main className="mx-auto w-full max-w-6xl px-4 py-8 sm:py-10">
        <div className="flex flex-col gap-2">
          <div className="text-sm text-muted-foreground">Main Screen</div>
          <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
            四季流转 · 双狗靠近
          </h1>
          <p className="max-w-2xl text-muted-foreground">
            「下一次见面」与「结束分离状态」两条进度：分子为成就页累加规则分，分母为你在主页分别设置的目标总分；满条时有彩带与贴贴动画。
          </p>
        </div>

        <div className="mt-8 grid gap-6 lg:grid-cols-2">
          <SeasonScene />
          <PuppyDistance />
        </div>
      </main>
    </div>
  );
}

