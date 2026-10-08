"use client";

import { useEffect, useRef, useState } from "react";

import { supabaseBearerHeaders } from "@/lib/supabase/apiSessionHeaders";

type RecordingMetadata = {
  id: string;
  lineId: string;
  role: string;
  status: string;
  visibility: string;
  durationMs?: number;
  createdAt: string;
  affectedRenders?: number;
};

/** Ownership-only management; it never requests former partners' data or audio URLs. */
export function MyDubbingRecordings() {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<RecordingMetadata[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [visibleCount, setVisibleCount] = useState(8);
  const deleteController = useRef<AbortController | null>(null);
  const deletingRef = useRef(false);

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    const load = async () => {
      try {
        const headers = await supabaseBearerHeaders();
        if (controller.signal.aborted) return;
        const response = await fetch("/api/dubbing/takes", { headers, signal: controller.signal, cache: "no-store" });
        const body: unknown = await response.json();
        if (controller.signal.aborted) return;
        if (!response.ok || !body || typeof body !== "object" || !("takes" in body) || !Array.isArray(body.takes)) throw new Error("无法读取我的录音，请确认已登录后重试。");
        const valid = body.takes.every((item: unknown) => item && typeof item === "object" && "id" in item && typeof item.id === "string" && "createdAt" in item && typeof item.createdAt === "string" && "status" in item && typeof item.status === "string" && "visibility" in item && typeof item.visibility === "string");
        if (!valid) throw new Error("录音信息暂时不完整，请稍后重试。");
        setItems(body.takes as RecordingMetadata[]);
        setError(null);
      } catch (failure) {
        if (!controller.signal.aborted) {
          setItems(null);
          setError(failure instanceof Error ? failure.message : "暂时无法读取我的录音。");
        }
      }
    };
    void load();
    return () => controller.abort();
  }, [open, refresh]);

  useEffect(() => () => deleteController.current?.abort(), []);

  const remove = async (item: RecordingMetadata) => {
    if (deletingRef.current) return;
    const affected = typeof item.affectedRenders === "number" ? `关联 ${item.affectedRenders} 个成片版本。` : "关联的成片也会受到影响。";
    if (!window.confirm(`撤回并删除这条录音？${affected}系统将停止相关任务的继续发布和新下载，但无法撤回已经下载的副本。`)) return;
    deletingRef.current = true;
    setDeleting(item.id);
    setError(null);
    const controller = new AbortController();
    deleteController.current = controller;
    try {
      const headers = await supabaseBearerHeaders();
      if (controller.signal.aborted) return;
      const response = await fetch(`/api/dubbing/takes?id=${encodeURIComponent(item.id)}`, { method: "DELETE", headers, signal: controller.signal });
      if (!response.ok) throw new Error("删除没有完成，请刷新录音状态后重试。");
      if (!controller.signal.aborted) setRefresh((value) => value + 1);
    } catch (failure) {
      if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : "删除没有完成，请稍后重试。");
    } finally {
      deletingRef.current = false;
      if (!controller.signal.aborted) setDeleting(null);
    }
  };

  return (
    <section className="rounded-2xl border border-rose-100 bg-white p-4 text-stone-800">
      <button type="button" aria-expanded={open} onClick={() => setOpen((value) => !value)} className="flex w-full items-center justify-between text-left text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose-500"><span>我的录音</span><span className="text-xs text-stone-500">{open ? "收起" : "管理与撤回"}</span></button>
      {open ? <div className="mt-3 space-y-3">
        <p className="text-xs leading-relaxed text-stone-600">这里只展示你自己的录音记录。退出情侣空间后仍可撤回自己的声音，不会恢复旧空间或伴侣素材的访问权限。</p>
        {error ? <p role="alert" className="text-xs text-rose-800">{error}</p> : null}
        {!items && !error ? <p role="status" className="text-xs text-stone-600">正在读取…</p> : null}
        {items?.length === 0 ? <p className="text-xs text-stone-600">还没有保存过录音。</p> : null}
        {items?.slice(0, visibleCount).map((item) => <div key={item.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-rose-50/50 p-3">
          <div className="text-xs leading-relaxed"><p className="font-medium">录音 {item.id.slice(0, 8)} · {item.role === "yellow_dog" ? "黄狗" : item.role === "white_dog" ? "白狗" : "我的角色"}</p><p className="text-stone-500">{Number.isFinite(Date.parse(item.createdAt)) ? new Date(item.createdAt).toLocaleString("zh-CN") : "时间未知"}{item.durationMs ? ` · ${(item.durationMs / 1000).toFixed(1)} 秒` : ""}</p><p className="text-stone-600">{item.visibility === "revoked" || item.status === "revoked" ? "已撤回" : item.visibility === "shared" ? "已向原参与者分享" : "私人草稿"}{typeof item.affectedRenders === "number" ? ` · 关联 ${item.affectedRenders} 个成片` : ""}</p></div>
          {item.visibility !== "revoked" && item.status !== "revoked" ? <button type="button" disabled={deleting !== null} onClick={() => void remove(item)} className="rounded-full border border-rose-200 bg-white px-3 py-2 text-xs text-rose-800 disabled:opacity-50">{deleting === item.id ? "正在撤回…" : "撤回并删除"}</button> : null}
        </div>)}
        <div className="flex gap-4 text-xs">{items && items.length > visibleCount ? <button type="button" onClick={() => setVisibleCount((value) => value + 20)} className="text-stone-700 underline underline-offset-4">显示更多</button> : null}<button type="button" disabled={deleting !== null} onClick={() => { setError(null); setRefresh((value) => value + 1); }} className="text-stone-700 underline underline-offset-4 disabled:opacity-50">刷新记录</button></div>
      </div> : null}
    </section>
  );
}
