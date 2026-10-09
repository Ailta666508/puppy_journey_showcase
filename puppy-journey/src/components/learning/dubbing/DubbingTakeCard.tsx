"use client";

import { useId, useRef, useState } from "react";

import { dubbingFailureLabel, safeStudioMediaUrl, type StudioTake } from "./studioClient";
import { RefreshingAudio, useRefreshingMediaSource } from "./RefreshingMedia";

const takeStatus: Record<StudioTake["status"], string> = {
  pending: "等待校验", validating: "正在校验", ready: "可提交", needs_trim: "待裁剪",
  failed: "校验未通过", revoked: "已撤回",
};

export function DubbingTakeCard({ take, windowMs, busy, canRevoke = !busy, onTrim, onRevoke, onRetry, onRefresh }: {
  take: StudioTake;
  windowMs: number;
  busy: boolean;
  canRevoke?: boolean;
  onTrim: (takeId: string, startMs: number, endMs: number) => Promise<void>;
  onRevoke: (takeId: string) => void;
  onRetry: (takeId: string) => void;
  onRefresh?: () => Promise<void>;
}) {
  const audioUrl = safeStudioMediaUrl(take.audioUrl);
  return (
    <div className="rounded-2xl border border-rose-100 bg-white p-3">
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
        <span className="font-medium">录音 {take.id.slice(0, 8)}</span>
        <span className={take.status === "ready" ? "text-emerald-800" : "text-stone-600"}>{takeStatus[take.status]}{take.durationMs ? ` · ${(take.durationMs / 1000).toFixed(1)} 秒` : ""}</span>
      </div>
      {audioUrl ? <RefreshingAudio src={audioUrl} label={`试听录音 ${take.id.slice(0, 8)}`} className="mt-3 h-9 w-full" onRefresh={onRefresh} /> : null}
      {take.status === "failed" ? <p role="status" className="mt-2 text-xs leading-relaxed text-rose-800">{dubbingFailureLabel(take.errorCode)}</p> : null}
      {take.status === "needs_trim" && audioUrl && take.durationMs ? (
        <TrimTakeEditor key={`${take.id}:${take.durationMs}`} audioUrl={audioUrl} durationMs={take.durationMs} windowMs={windowMs} busy={busy} onTrim={(start, end) => onTrim(take.id, start, end)} />
      ) : null}
      {take.status !== "revoked" ? (
        <div className="mt-3 flex flex-wrap gap-3 text-xs">
          {take.status === "failed" ? <button type="button" disabled={busy} onClick={() => onRetry(take.id)} className="text-stone-700 underline underline-offset-4 disabled:opacity-50">重试校验</button> : null}
          <button type="button" disabled={!canRevoke} onClick={() => onRevoke(take.id)} className="text-rose-800 underline underline-offset-4 disabled:opacity-50">撤回并删除这条录音</button>
        </div>
      ) : null}
    </div>
  );
}

function TrimTakeEditor({ audioUrl, durationMs, windowMs, busy, onTrim }: {
  audioUrl: string; durationMs: number; windowMs: number; busy: boolean;
  onTrim: (startMs: number, endMs: number) => Promise<void>;
}) {
  const [start, setStart] = useState("0");
  const [end, setEnd] = useState((durationMs / 1000).toFixed(3));
  const [heardRange, setHeardRange] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const preview = useRef<HTMLAudioElement>(null);
  const managedMedia = useRefreshingMediaSource<HTMLAudioElement>(audioUrl, undefined, preview);
  const activeRange = useRef<{ startMs: number; endMs: number; key: string } | null>(null);
  const startId = useId();
  const endId = useId();
  const startMs = Math.round(Number(start) * 1000);
  const endMs = Math.round(Number(end) * 1000);
  const valid = start.trim() !== "" && end.trim() !== "" && Number.isFinite(startMs) && Number.isFinite(endMs) &&
    startMs >= 0 && endMs > startMs && endMs <= durationMs && endMs - startMs <= windowMs;
  const rangeKey = `${startMs}:${endMs}`;

  const playRange = () => {
    if (!valid || !preview.current) return;
    setMessage(null);
    setHeardRange(null);
    activeRange.current = { startMs, endMs, key: rangeKey };
    const element = preview.current;
    const play = () => {
      element.currentTime = startMs / 1000;
      void element.play().catch(() => setMessage("未能试听，请检查音频链接后重试。"));
    };
    if (element.readyState >= 1) play();
    else {
      element.onloadedmetadata = play;
      element.load();
    }
  };
  const completeRange = () => {
    if (!preview.current || !activeRange.current) return;
    if (preview.current.ended || preview.current.currentTime * 1000 >= activeRange.current.endMs) {
      preview.current.pause();
      setHeardRange(activeRange.current.key);
      activeRange.current = null;
    }
  };
  const changeRange = (value: string, setter: (value: string) => void) => {
    preview.current?.pause();
    activeRange.current = null;
    setHeardRange(null);
    setter(value);
  };

  return (
    <div className="mt-3 border-t border-rose-100 pt-3">
      <p className="text-xs leading-relaxed text-stone-600">只裁去首尾空白。先完整试听所选片段，再保存新版本；不要剪掉词尾。原录音不会覆盖。</p>
      <div className="mt-3 grid grid-cols-2 gap-3 text-xs">
        <label htmlFor={startId}>开始（秒）<input id={startId} type="number" min="0" max={durationMs / 1000} step="0.1" value={start} onChange={(event) => changeRange(event.target.value, setStart)} className="mt-1 w-full rounded-lg border border-rose-200 bg-white p-2" /></label>
        <label htmlFor={endId}>结束（秒）<input id={endId} type="number" min="0" max={durationMs / 1000} step="0.1" value={end} onChange={(event) => changeRange(event.target.value, setEnd)} className="mt-1 w-full rounded-lg border border-rose-200 bg-white p-2" /></label>
      </div>
      <audio {...managedMedia} preload="none" onTimeUpdate={() => { managedMedia.onTimeUpdate(); completeRange(); }} onEnded={completeRange} onError={() => { void managedMedia.onError(); setMessage("音频暂时无法读取，请刷新后重试。"); }} />
      {!valid ? <p className="mt-2 text-xs text-amber-800">请选择有效的首尾时间，裁剪后不超过 {(windowMs / 1000).toFixed(1)} 秒。</p> : null}
      {message ? <p role="alert" className="mt-2 text-xs text-rose-800">{message}</p> : null}
      {heardRange === rangeKey ? <p role="status" className="mt-2 text-xs text-emerald-800">所选片段已试听，请确认没有截断台词。</p> : null}
      <div className="mt-3 flex flex-wrap gap-3 text-xs">
        <button type="button" disabled={!valid || busy} onClick={playRange} className="rounded-full border border-rose-200 px-3 py-2 disabled:opacity-50">试听所选片段</button>
        <button type="button" disabled={!valid || busy || heardRange !== rangeKey} onClick={() => void onTrim(startMs, endMs)} className="rounded-full bg-rose-500 px-3 py-2 text-white disabled:opacity-50">确认裁剪并保存新版本</button>
      </div>
    </div>
  );
}
