"use client";

import { TopNav } from "@/components/TopNav";
import { RehearsalTheaterView } from "@/components/learning/RehearsalTheaterView";

/**
 * 未来排练室：放映厅交互演示（剧场 + 看电影小狗 → 全屏占位放映 + Agent 7 → 词汇瀑布流）
 */
export default function LearningPage() {
  return (
    <div className="min-h-screen bg-[#0c1222]">
      <TopNav />
      <RehearsalTheaterView />
    </div>
  );
}
