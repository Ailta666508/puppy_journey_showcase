"use client";

import { useEffect } from "react";

import { TopNav } from "@/components/TopNav";
import { TravelLogComposer } from "@/components/TravelLogComposer";
import { TravelTimeline } from "@/components/TravelTimeline";
import { QAvatarGenerator } from "@/components/QAvatarGenerator";
import { useAppStore, type AppState } from "@/store/useAppStore";

export default function TravelPage() {
  const fetchTravelLogs = useAppStore((s: AppState) => s.fetchTravelLogs);
  const currentUserRole = useAppStore((s: AppState) => s.currentUserRole);

  useEffect(() => {
    void fetchTravelLogs();
  }, [fetchTravelLogs, currentUserRole]);

  return (
    <div className="min-h-screen bg-background">
      <TopNav />
      <main className="mx-auto w-full max-w-6xl px-4 py-8 sm:py-10">
        <div className="flex flex-col gap-2">
          <div className="text-sm text-muted-foreground">Travel Journal</div>
          <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">旅行日志</h1>
          <p className="max-w-2xl text-muted-foreground">
            结构化记录（多图、时间线、地点、随笔）。这些数据会在后续作为 RAG/多智能体外语模块的 Context。
          </p>
        </div>

        <div className="mt-8 grid gap-6 lg:grid-cols-2">
          <TravelLogComposer />
          <QAvatarGenerator />
        </div>

        <div className="mt-8">
          <TravelTimeline />
        </div>
      </main>
    </div>
  );
}

