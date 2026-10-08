"use client";

import Link from "next/link";
import { DubbingAuthBoundary } from "@/components/learning/dubbing/DubbingAuthBoundary";
import { MyDubbingRecordings } from "@/components/learning/dubbing/MyDubbingRecordings";

/** Ownership management remains reachable when a relationship is no longer active. */
export default function RecordingsPage() {
  return <main className="min-h-screen bg-[#fff7f6] px-4 py-10 text-stone-800">
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">我的配音记录</h1>
        <Link href="/learning" className="text-sm text-rose-700 underline underline-offset-4">返回未来排练室</Link>
      </div>
      <p className="text-sm leading-relaxed text-stone-600">管理自己上传的声音。即使退出情侣空间，仍可以撤回自己的录音及其关联成片。</p>
      <DubbingAuthBoundary>{(userId) => <MyDubbingRecordings key={userId} />}</DubbingAuthBoundary>
    </div>
  </main>;
}
