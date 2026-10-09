"use client";

import { useEffect, useId, useRef, useState, useSyncExternalStore } from "react";

import {
  canSaveRecording,
  hasUnsavedRecording,
  RECORDING_LIMIT_MS,
  RoleRecordingController,
  type RecordingUpload,
} from "@/lib/dubbing/recorder";

export type RoleRecorderProps = {
  lineId: string;
  text: string;
  translation?: string;
  windowMs: number;
  disabled?: boolean;
  onRecordStart?: () => void;
  onSave: (upload: RecordingUpload) => Promise<void>;
};

const primaryButton = "rounded-full bg-rose-500 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-rose-600 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose-500";
const secondaryButton = "rounded-full border border-rose-200 bg-white px-4 py-2 text-sm font-medium text-stone-700 transition-colors hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose-500";

/** This component must only be mounted for a server-authorized, ready guide line. */
export function RoleRecorder(props: RoleRecorderProps) {
  return <RecorderSession key={`${props.lineId}:${props.windowMs}`} {...props} />;
}

function RecorderSession({ text, translation, windowMs, disabled = false, onRecordStart, onSave }: RoleRecorderProps) {
  const [controller] = useState(() => new RoleRecordingController());
  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  const [privateSaveAccepted, setPrivateSaveAccepted] = useState(false);
  const audioRef = useRef<HTMLAudioElement>(null);
  const titleId = useId();
  const permissionId = useId();
  const validWindow = Number.isFinite(windowMs) && windowMs > 0 && windowMs <= RECORDING_LIMIT_MS;
  const activeCapture = ["requesting_permission", "countdown", "recording", "stopping"].includes(snapshot.phase);
  const localPreview = snapshot.phase === "preview" || snapshot.phase === "uploading" || snapshot.phase === "uploaded";
  const overWindow = validWindow && snapshot.elapsedMs > windowMs;
  const incomplete = snapshot.stoppedByLimit || snapshot.interrupted;

  useEffect(() => {
    controller.activate();
    const visibilityChanged = () => {
      if (document.hidden) controller.interrupt();
    };
    const pageLeft = () => controller.interrupt("页面已关闭或离开，本次录音中断，请重录。");
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (hasUnsavedRecording(controller.getSnapshot())) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    document.addEventListener("visibilitychange", visibilityChanged);
    window.addEventListener("pagehide", pageLeft);
    window.addEventListener("beforeunload", beforeUnload);
    return () => {
      document.removeEventListener("visibilitychange", visibilityChanged);
      window.removeEventListener("pagehide", pageLeft);
      window.removeEventListener("beforeunload", beforeUnload);
      controller.dispose();
    };
  }, [controller]);

  useEffect(() => {
    if (disabled) controller.interrupt("当前台词暂时不能录制，本次录音已停止，请重新确认会话状态。");
  }, [controller, disabled]);

  const startRecording = () => {
    if (disabled || !validWindow) return;
    audioRef.current?.pause();
    setPrivateSaveAccepted(false);
    void controller.start(onRecordStart);
  };

  return (
    <section aria-labelledby={titleId} className="rounded-3xl border border-rose-100 bg-[#fffafa] p-5 text-stone-800">
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
        <span className="rounded-full bg-rose-100 px-3 py-1 font-medium text-rose-800">我的声音</span>
        {validWindow ? <span className="text-stone-600">台词窗口 {(windowMs / 1000).toFixed(1)} 秒</span> : null}
      </div>
      <p id={titleId} lang="es" className="mt-4 text-lg font-semibold leading-relaxed">{text}</p>
      {translation ? <p className="mt-1 text-sm leading-relaxed text-stone-600">{translation}</p> : null}

      {!validWindow ? <p role="alert" className="mt-3 text-sm text-rose-800">这句台词的录音时间尚未准备好，请等待示范完成。</p> : null}
      <p className="mt-3 text-xs leading-relaxed text-stone-600">建议戴上耳机。录音仅保留在本机，点击保存后才上传；不申请摄像头。</p>

      <div className="mt-4 min-h-6" role="status" aria-live="polite" aria-atomic="true">
        {snapshot.phase === "requesting_permission" ? <p className="text-sm">请在浏览器提示中允许使用麦克风…</p> : null}
        {snapshot.phase === "countdown" ? <p className="text-sm">准备好，<strong className="text-xl tabular-nums text-rose-700">{snapshot.countdown}</strong> 秒后开始录音</p> : null}
        {snapshot.phase === "recording" ? <p className="flex items-center gap-2 text-sm font-medium text-rose-800"><span aria-hidden="true" className="size-2 rounded-full bg-rose-500" />正在录音</p> : null}
        {snapshot.phase === "stopping" ? <p className="text-sm">正在整理录音，请稍候…</p> : null}
        {snapshot.phase === "uploading" ? <p className="text-sm">正在保存私人草稿，请勿关闭页面…</p> : null}
        {snapshot.phase === "uploaded" ? <p className="text-sm font-medium text-emerald-800">已上传，请等待服务器校验；尚未提交给伴侣。</p> : null}
      </div>

      {snapshot.phase === "recording" || snapshot.phase === "stopping" || localPreview ? (
        <div className="mt-2">
          <div className="mb-2 flex items-center justify-between text-xs text-stone-600">
            <span className="tabular-nums">本机计时 {(snapshot.elapsedMs / 1000).toFixed(1)} 秒</span>
            <span>最长 10 秒</span>
          </div>
          <progress aria-label="录音时长" value={Math.min(snapshot.elapsedMs, RECORDING_LIMIT_MS)} max={RECORDING_LIMIT_MS} className="h-2 w-full accent-rose-500" />
          {overWindow && !incomplete ? (
            <p className="mt-2 text-xs leading-relaxed text-amber-800">已超出台词窗口约 {((snapshot.elapsedMs - windowMs) / 1000).toFixed(1)} 秒。完整录音可保存为待裁剪草稿，校验通过前不能提交或合成。</p>
          ) : null}
        </div>
      ) : null}

      {snapshot.stoppedByLimit ? <p role="alert" className="mt-3 text-sm leading-relaxed text-rose-800">已达到 10 秒上限并停止，可能未录完。这段只能试听，请重录后再保存。</p> : null}
      {snapshot.error ? <p role="alert" className="mt-3 text-sm leading-relaxed text-rose-800">{snapshot.error}</p> : null}

      {localPreview && snapshot.previewUrl ? (
        <div className="mt-4 rounded-2xl bg-white p-3">
          <p className="mb-2 text-xs font-medium text-stone-600">{snapshot.phase === "uploaded" ? "本机试听" : "本机试听 · 未保存"}</p>
          <audio ref={audioRef} aria-label="试听我的本句录音" controls preload="metadata" src={snapshot.previewUrl} className="h-10 w-full" />
        </div>
      ) : null}

      {snapshot.phase === "preview" && !incomplete ? (
        <label htmlFor={permissionId} className="mt-4 flex cursor-pointer items-start gap-2 text-xs leading-relaxed text-stone-600">
          <input id={permissionId} type="checkbox" checked={privateSaveAccepted} onChange={(event) => setPrivateSaveAccepted(event.target.checked)} className="mt-0.5 accent-rose-500" />
          <span>保存为仅我可访问的私人草稿，不代表同意分享或合成。未保存录音刷新后会丢失。</span>
        </label>
      ) : null}

      <div className="mt-4 flex flex-wrap gap-2">
        {!activeCapture && snapshot.phase !== "uploading" ? (
          <button type="button" disabled={disabled || !validWindow} onClick={startRecording} className={secondaryButton}>
            {localPreview ? "重新录这一句" : "开始录音"}
          </button>
        ) : null}
        {snapshot.phase === "recording" ? <button type="button" onClick={() => controller.stop()} className={primaryButton}>停止录音</button> : null}
        {snapshot.phase === "requesting_permission" || snapshot.phase === "countdown" ? <button type="button" onClick={() => controller.discard()} className={secondaryButton}>取消</button> : null}
        {snapshot.phase === "preview" ? (
          <>
            <button type="button" disabled={disabled || !validWindow || !privateSaveAccepted || !canSaveRecording(snapshot)} onClick={() => void controller.save(onSave)} className={primaryButton}>
              {overWindow ? "保存待裁剪草稿" : "保存这一句"}
            </button>
            <button type="button" onClick={() => controller.discard()} className={secondaryButton}>删除本机录音</button>
          </>
        ) : null}
      </div>
    </section>
  );
}
