"use client";

import { TopNav } from "@/components/TopNav";
import { RehearsalTheaterView } from "@/components/learning/RehearsalTheaterView";

/**
 * 未来排练室：剧本与视频生成、分角色配音、放映和词汇练习。
 */
export default function LearningPage() {
  return (
    <div className="min-h-screen bg-[#0c1222]">
      <TopNav />
      <RehearsalTheaterView />
    </div>
  );
}
