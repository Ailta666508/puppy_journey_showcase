"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Icon } from "@/components/IconManager";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getApiErrorField, getErrorMessage } from "@/lib/getErrorMessage";
import type { AchievementTask } from "./types";
import { cn } from "@/lib/utils";

type Props = {
  open: boolean;
  onClose: () => void;
  onCreated: (task: AchievementTask) => void;
};

/** 新增成就：标题 + 规则分值（归属待登录后由账号决定，现默认记为「我的」） */
export function AddAchievementModal({ open, onClose, onCreated }: Props) {
  const [title, setTitle] = useState("");
  const [score, setScore] = useState<5 | 10 | 20>(5);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  async function submit() {
    setErr("");
    if (!title.trim()) {
      setErr("请填写成就标题");
      return;
    }
    setLoading(true);
    try {
      const { achievementAuthHeaders } = await import("@/lib/achievements/clientAuth");
      const res = await fetch("/api/achievements/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await achievementAuthHeaders()) },
        body: JSON.stringify({
          title: title.trim(),
          score,
        }),
      });
      const data = (await res.json()) as { ok?: boolean; task?: AchievementTask; error?: unknown };
      if (!res.ok || !data.ok || !data.task) throw new Error(getApiErrorField(data.error, "保存失败"));
      setTitle("");
      setScore(5);
      onCreated(data.task);
      onClose();
    } catch (e) {
      setErr(getErrorMessage(e) || "网络错误");
    } finally {
      setLoading(false);
    }
  }

  return (
    <AnimatePresence>
      {open ? (
        <>
          <motion.button
            type="button"
            className="fixed inset-0 z-[85] bg-black/45 backdrop-blur-sm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            aria-label="关闭"
          />
          <motion.div
            role="dialog"
            className="fixed left-1/2 top-1/2 z-[90] w-[min(92vw,400px)] -translate-x-1/2 -translate-y-1/2 rounded-3xl border bg-card p-6 shadow-2xl"
            initial={{ opacity: 0, scale: 0.94 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.94 }}
            transition={{ type: "spring", damping: 26, stiffness: 320 }}
          >
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-lg font-semibold">新增成就</h3>
              <button type="button" className="rounded-lg p-1 text-muted-foreground hover:bg-muted" onClick={onClose} aria-label="关闭">
                <Icon name="close" size={20} />
              </button>
            </div>
            <div className="mt-4 grid gap-3">
              <div className="grid gap-2">
                <Label htmlFor="ach-title">成就标题</Label>
                <Input id="ach-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="例如：一起看完一季剧" />
              </div>
              <div className="grid gap-2">
                <span className="text-sm font-medium">难度 / 分值</span>
                <div className="flex flex-wrap gap-2">
                  <ScoreCapsule active={score === 5} onClick={() => setScore(5)} label="🌱 随手小事" suffix="+5分" />
                  <ScoreCapsule active={score === 10} onClick={() => setScore(10)} label="💪 有点挑战" suffix="+10分" />
                  <ScoreCapsule active={score === 20} onClick={() => setScore(20)} label="🔥 突破自我" suffix="+20分" />
                </div>
              </div>
              {err ? <p className="text-sm text-destructive">{err}</p> : null}
            </div>
            <div className="mt-6 flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={onClose}>
                取消
              </Button>
              <Button type="button" className="pj-btn-gradient text-white" disabled={loading} onClick={() => void submit()}>
                {loading ? "保存中…" : "创建"}
              </Button>
            </div>
          </motion.div>
        </>
      ) : null}
    </AnimatePresence>
  );
}

function ScoreCapsule(props: {
  active: boolean;
  onClick: () => void;
  label: string;
  suffix: string;
}) {
  return (
    <button
      type="button"
      onClick={props.onClick}
      className={cn(
        "rounded-full border px-3 py-1.5 text-left text-xs font-medium transition-colors sm:text-[13px]",
        props.active
          ? "border-primary bg-primary/15 text-primary shadow-sm"
          : "border-border/80 bg-background/80 text-muted-foreground hover:bg-muted/60",
      )}
    >
      <span className="block leading-tight">{props.label}</span>
      <span className="text-[10px] font-semibold opacity-90">{props.suffix}</span>
    </button>
  );
}
