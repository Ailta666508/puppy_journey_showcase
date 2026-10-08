"use client";

import { useId, useState } from "react";

import type { DubbingPlan } from "@/lib/dubbing/contracts";

import { dubbingFailureLabel, safeStudioMediaUrl, type StudioRender } from "./studioClient";
import { RefreshingVideo } from "./RefreshingMedia";

const labels: Record<StudioRender["status"], string> = {
  awaiting_consent: "等待确认", queued: "已排队", running: "正在合成",
  completed: "已完成", failed: "合成未完成", cancelled: "已取消", revoked: "已撤回",
};

export function DubbingRenderCard({ render, plan, userId, synthetic, busy, onConsent, onCancel, onRetry, onRefresh, onDownload, onPreview }: {
  render: StudioRender; plan: DubbingPlan; userId: string; synthetic: boolean; busy: boolean;
  onConsent: (renderId: string, digest: string) => void;
  onCancel: (renderId: string) => void;
  onRetry: (renderId: string) => void;
  onRefresh?: () => Promise<void>;
  onDownload?: (renderId: string, kind: "video" | "subtitles") => void;
  onPreview?: () => void;
}) {
  const [accepted, setAccepted] = useState(false);
  const consentId = useId();
  const videoUrl = safeStudioMediaUrl(render.videoUrl);
  const downloadUrl = safeStudioMediaUrl(render.downloadUrl);
  const subtitleUrl = safeStudioMediaUrl(render.subtitleUrl);
  const needsMyConsent = render.status === "awaiting_consent" && render.requiredConsentIds.includes(userId) && !render.consentedBy.includes(userId);
  const hasBoundManifest = render.manifest?.digest === render.manifestDigest && Boolean(render.manifest?.lines.length);

  return (
    <article className="rounded-2xl border border-rose-100 bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-sm font-medium">{render.mode === "solo" ? "我的练习版" : "双人配音版"} · {render.id.slice(0, 8)}</h4>
        <span className="text-xs text-stone-600">{labels[render.status]}</span>
      </div>
      {synthetic ? <p className="mt-2 text-xs text-amber-800">本地测试版本，未替换的示范为合成提示音，不用于发音学习。</p> : null}
      {render.status === "completed" && videoUrl ? (
        <div className="mt-3">
          {onPreview ? <button type="button" onClick={onPreview} className="rounded-full bg-rose-500 px-4 py-2 text-xs font-medium text-white">在剧场播放</button> : <RefreshingVideo src={videoUrl} subtitleUrl={subtitleUrl} className="max-h-72 w-full rounded-xl bg-stone-950" onRefresh={onRefresh} />}
          <div className="mt-3 flex flex-wrap gap-4 text-xs">
            {downloadUrl ? <button type="button" disabled={busy || !onDownload} onClick={() => onDownload?.(render.id, "video")} className="font-medium text-rose-800 underline underline-offset-4 disabled:opacity-50">下载 MP4</button> : null}
            {subtitleUrl ? <button type="button" disabled={busy || !onDownload} onClick={() => onDownload?.(render.id, "subtitles")} className="text-stone-700 underline underline-offset-4 disabled:opacity-50">下载字幕</button> : null}
          </div>
        </div>
      ) : null}
      {render.manifest ? (
        <details className="mt-3 text-xs" open={needsMyConsent}>
          <summary className="cursor-pointer font-medium text-stone-700">本次成片清单</summary>
          <ol className="mt-2 space-y-2 leading-relaxed text-stone-600">
            {render.manifest.lines.map((line) => {
              const scriptLine = plan.lines.find((entry) => entry.lineId === line.lineId);
              return <li key={line.lineId}><span lang="es">{scriptLine?.text ?? line.lineId}</span><br /><span className="font-medium">{line.source.kind === "ai" ? "AI 示范" : `${line.source.ownerId === userId ? "我的声音" : "伴侣的声音"} · 录音 ${line.source.takeId.slice(0, 8)}`}</span></li>;
            })}
          </ol>
        </details>
      ) : null}
      {needsMyConsent ? (
        <div className="mt-4 rounded-xl bg-rose-50 p-3">
          {!hasBoundManifest ? <p className="text-xs text-rose-800">成片清单尚未完整读取，暂时不能确认，请刷新。</p> : (
            <>
              <label htmlFor={consentId} className="flex items-start gap-2 text-xs leading-relaxed"><input id={consentId} type="checkbox" checked={accepted} onChange={(event) => setAccepted(event.target.checked)} className="mt-0.5 accent-rose-500" /><span>我已核对以上录音版本，同意仅将我的声音用于这份成片清单。更换素材后需要重新确认。</span></label>
              <button type="button" disabled={busy || !accepted} onClick={() => onConsent(render.id, render.manifestDigest)} className="mt-3 rounded-full bg-rose-500 px-4 py-2 text-xs font-medium text-white disabled:opacity-50">确认这份清单</button>
            </>
          )}
        </div>
      ) : null}
      {render.status === "awaiting_consent" && render.consentedBy.includes(userId) ? <p role="status" className="mt-3 text-xs text-stone-600">你已确认此版本，等待其余参与者确认。</p> : null}
      {render.status === "failed" ? <p role="status" className="mt-3 text-xs text-rose-800">{dubbingFailureLabel(render.errorCode)}</p> : null}
      <div className="mt-3 flex flex-wrap gap-3 text-xs">
        {render.status === "failed" ? <button type="button" disabled={busy} onClick={() => onRetry(render.id)} className="text-stone-700 underline underline-offset-4 disabled:opacity-50">重试合成</button> : null}
        {render.manifest?.requesterId === userId && ["awaiting_consent", "queued", "running"].includes(render.status) ? <button type="button" disabled={busy} onClick={() => onCancel(render.id)} className="text-stone-600 underline underline-offset-4 disabled:opacity-50">取消这次合成</button> : null}
      </div>
    </article>
  );
}
