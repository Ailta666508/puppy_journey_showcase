"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import Link from "next/link";

import type { RenderChoice } from "@/lib/dubbing/renderPlan";
import type { RecordingUpload } from "@/lib/dubbing/recorder";
import { supabaseBearerHeaders } from "@/lib/supabase/apiSessionHeaders";

import { DubbingRenderCard } from "./DubbingRenderCard";
import { DubbingTakeCard } from "./DubbingTakeCard";
import { RoleRecorder } from "./RoleRecorder";
import { RefreshingVideo } from "./RefreshingMedia";
import styles from "./DubbingStudio.module.css";
import {
  choicesAreReady, dubbingFailureLabel, parseStudioSnapshot, safeStudioMediaUrl,
  studioHasPendingWork, type StudioSnapshot,
} from "./studioClient";

type DraftChoices = { sessionId: string; revision: number; choices: Record<string, RenderChoice> };
const button = "rounded-full border border-rose-200 bg-white px-4 py-2 text-xs font-medium text-stone-700 transition-colors hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose-500";
const pinkButton = `${button} !border-rose-500 !bg-rose-500 !text-white hover:!bg-rose-600`;

export type DubbingPlayback = { id: string; url: string; subtitleUrl?: string; label: string; synthetic: boolean };
type StudioProps = {
  pipelineJobId: string;
  onRecordStart?: () => void;
  presentation?: "standalone" | "theater";
  onPlaybackChange?: (playback: DubbingPlayback | null) => void;
  onLeaveGuardChange?: (guard: (() => boolean) | null) => void;
};

export function DubbingStudio(props: StudioProps) {
  return <StudioSession key={props.pipelineJobId} {...props} />;
}

function StudioSession({ pipelineJobId, onRecordStart, presentation = "standalone", onPlaybackChange, onLeaveGuardChange }: StudioProps) {
  const [snapshot, setSnapshot] = useState<StudioSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<DraftChoices | null>(null);
  const [sharingAccepted, setSharingAccepted] = useState(false);
  const [recordingLineId, setRecordingLineId] = useState<string | null>(null);
  const [auditionLabel, setAuditionLabel] = useState<string | null>(null);
  const [tab, setTab] = useState<"guide" | "record" | "renders">("guide");
  const [selectedPlayback, setSelectedPlayback] = useState("guide");
  const fetchController = useRef<AbortController | null>(null);
  const mutationController = useRef<AbortController | null>(null);
  const mounted = useRef(false);
  const mutating = useRef(false);
  const requestKeys = useRef(new Map<string, string>());
  const uploadKeys = useRef(new WeakMap<Blob, string>());
  const area = useRef<HTMLElement>(null);
  const audition = useRef<HTMLAudioElement>(null);
  const sharingId = useId();
  const busy = saving || !snapshot?.capabilities.enabled;
  const lastLoadedAt = useRef(0);
  const embedded = presentation === "theater";
  const showGuide = !embedded || tab === "guide";
  const showRecording = !embedded || tab === "record";
  const showRenders = !embedded || tab === "renders";

  const load = useCallback(async () => {
    fetchController.current?.abort();
    const controller = new AbortController();
    fetchController.current = controller;
    try {
      const headers = await supabaseBearerHeaders();
      if (controller.signal.aborted) return;
      const response = await fetch(`/api/dubbing?pipelineJobId=${encodeURIComponent(pipelineJobId)}`, { headers, signal: controller.signal, cache: "no-store" });
      const body: unknown = await response.json();
      if (controller.signal.aborted || !mounted.current) return;
      if (!response.ok) {
        if (response.status >= 400 && response.status < 500) {
          setSnapshot(null);
          setRecordingLineId(null);
          setAuditionLabel(null);
          area.current?.querySelectorAll<HTMLMediaElement>("video,audio").forEach((media) => { media.pause(); media.removeAttribute("src"); media.load(); });
        }
        throw new Error(readResponseError(body));
      }
      const parsed = parseStudioSnapshot(body);
      setSnapshot(parsed);
      lastLoadedAt.current = Date.now();
      setLoading(false);
      return parsed;
    } catch (failure) {
      if (!controller.signal.aborted && mounted.current) {
        setError(failure instanceof Error ? failure.message : "配音状态暂时无法读取，请稍后刷新。");
        setLoading(false);
      }
    }
  }, [pipelineJobId]);

  useEffect(() => {
    mounted.current = true;
    void load();
    return () => {
      mounted.current = false;
      fetchController.current?.abort();
      mutationController.current?.abort();
    };
  }, [load]);

  const pending = snapshot ? studioHasPendingWork(snapshot) : false;
  useEffect(() => {
    const poll = () => { if (!document.hidden && !mutating.current) void load(); };
    // Media links expire after 60 seconds. Ready sessions still renew in the foreground.
    const timer = window.setInterval(poll, pending ? 3000 : 45_000);
    document.addEventListener("visibilitychange", poll);
    return () => { window.clearInterval(timer); document.removeEventListener("visibilitychange", poll); };
  }, [pending, load]);

  const refreshMedia = async () => { await load(); };

  useEffect(() => {
    if (!embedded || !onPlaybackChange) return;
    if (selectedPlayback === "guide") {
      const guide = snapshot?.guide;
      const url = guide?.status === "ready" ? safeStudioMediaUrl(guide.videoUrl) : undefined;
      onPlaybackChange(url && guide ? { id: guide.id, url, subtitleUrl: safeStudioMediaUrl(guide.subtitleUrl), label: "有声示范", synthetic: Boolean(guide.synthetic) } : null);
    } else {
      const render = snapshot?.renders.find((entry) => entry.id === selectedPlayback && entry.status === "completed");
      const url = safeStudioMediaUrl(render?.videoUrl);
      onPlaybackChange(render && url ? { id: render.id, url, subtitleUrl: safeStudioMediaUrl(render.subtitleUrl), label: `${render.mode === "solo" ? "我的练习版" : "双人配音版"} · ${render.id.slice(0, 8)}`, synthetic: Boolean(snapshot?.guide?.synthetic) } : null);
    }
  }, [embedded, onPlaybackChange, selectedPlayback, snapshot]);

  useEffect(() => () => onPlaybackChange?.(null), [onPlaybackChange]);

  const canLeaveRecording = useCallback(() => !recordingLineId || window.confirm("离开录音面板会丢失尚未保存的本机录音，确定继续吗？"), [recordingLineId]);
  useEffect(() => {
    onLeaveGuardChange?.(canLeaveRecording);
    return () => onLeaveGuardChange?.(null);
  }, [canLeaveRecording, onLeaveGuardChange]);

  const mutate = async (fields: Record<string, unknown>): Promise<boolean> => {
    if (mutating.current) return false;
    if (!snapshot?.capabilities.enabled && fields.action !== "revoke_take") {
      setError("角色配音暂未启用；已有录音仍可在“我的录音”管理和撤回。");
      return false;
    }
    mutating.current = true;
    setBusy(true);
    setError(null);
    const controller = new AbortController();
    mutationController.current = controller;
    const fingerprint = JSON.stringify(fields);
    const requestKey = requestKeys.current.get(fingerprint) ?? crypto.randomUUID();
    requestKeys.current.set(fingerprint, requestKey);
    try {
      const headers = new Headers(await supabaseBearerHeaders());
      if (controller.signal.aborted) return false;
      headers.set("Content-Type", "application/json");
      const response = await fetch("/api/dubbing", { method: "POST", headers, signal: controller.signal, body: JSON.stringify({ ...fields, pipelineJobId, requestKey }) });
      const body: unknown = await response.json();
      if (!response.ok) throw new Error(readResponseError(body));
      if (!mounted.current || controller.signal.aborted) return false;
      requestKeys.current.delete(fingerprint);
      await load();
      return true;
    } catch (failure) {
      if (mounted.current && !controller.signal.aborted) setError(failure instanceof Error ? failure.message : "操作没有完成，请稍后重试。");
      return false;
    } finally {
      mutating.current = false;
      if (mounted.current) setBusy(false);
    }
  };

  const uploadTake = async (lineId: string, upload: RecordingUpload) => {
    if (!snapshot?.session || !snapshot.capabilities.enabled || mutating.current) throw new Error("session unavailable");
    mutating.current = true;
    setBusy(true);
    setError(null);
    try {
      const headers = await supabaseBearerHeaders();
      if (upload.signal?.aborted) throw new Error("upload cancelled");
      const requestKey = uploadKeys.current.get(upload.blob) ?? crypto.randomUUID();
      uploadKeys.current.set(upload.blob, requestKey);
      const body = new FormData();
      body.set("sessionId", snapshot.session.id);
      body.set("lineId", lineId);
      body.set("requestKey", requestKey);
      body.set("file", upload.blob, `recording.${upload.mimeType.includes("mp4") ? "m4a" : "webm"}`);
      const response = await fetch("/api/dubbing/takes", { method: "POST", headers, body, signal: upload.signal });
      if (!response.ok) {
        const failure: unknown = await response.json();
        if (failure && typeof failure === "object" && "code" in failure && failure.code === "DUBBING_UPLOAD_EXPIRED") {
          // The original object was cleaned up; retry the same local Blob with a new upload key.
          uploadKeys.current.delete(upload.blob);
          throw new Error("上次上传已过期，本机录音仍然保留。请再次点击保存，无需重新录音。");
        }
        throw new Error(readResponseError(failure));
      }
      if (mounted.current && !upload.signal?.aborted) await load();
    } catch (failure) {
      if (mounted.current && !upload.signal?.aborted) setError(failure instanceof Error ? failure.message : "录音保存没有完成。");
      throw failure;
    } finally {
      mutating.current = false;
      if (mounted.current) setBusy(false);
    }
  };

  const pauseMedia = () => {
    area.current?.querySelectorAll<HTMLMediaElement>("video,audio").forEach((element) => element.pause());
    onRecordStart?.();
  };
  const listen = async (selectUrl: (current: StudioSnapshot) => string | undefined, label: string) => {
    const current = Date.now() - lastLoadedAt.current > 40_000 ? await load() : snapshot;
    if (!current || !mounted.current) return;
    const url = selectUrl(current);
    const safeUrl = safeStudioMediaUrl(url);
    if (!safeUrl || !audition.current) return;
    pauseMedia();
    audition.current.src = safeUrl;
    setAuditionLabel(label);
    void audition.current.play().catch(() => setError("音频暂时无法播放，请刷新链接后重试。"));
  };
  const download = async (renderId: string, kind: "video" | "subtitles") => {
    const current = await load();
    if (!current || !mounted.current) return;
    const render = current.renders.find((entry) => entry.id === renderId && entry.status === "completed");
    const url = safeStudioMediaUrl(kind === "video" ? render?.downloadUrl : render?.subtitleUrl);
    if (!url) { setError("这个成片已不可下载，请检查声音授权与最新状态。"); return; }
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = kind === "video" ? "puppy-dubbing.mp4" : "puppy-dubbing.vtt";
    anchor.rel = "noopener";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  };
  const openRecorder = (lineId: string) => {
    if (recordingLineId && !window.confirm("切换或关闭录音面板会丢失未保存的声音，确定继续吗？")) return;
    pauseMedia();
    setRecordingLineId((previous) => previous === lineId ? null : lineId);
  };
  const changeTab = (next: "guide" | "record" | "renders") => {
    if (recordingLineId && next !== "record") {
      if (!window.confirm("离开配音页签会丢失尚未保存的本机录音，确定继续吗？")) return;
      setRecordingLineId(null);
    }
    pauseMedia();
    setTab(next);
  };
  const revoke = (takeId: string) => {
    if (window.confirm("撤回并删除这条录音？使用它的待合成任务与成片将停止继续发布或下载。已经下载的副本无法远程撤回。")) void mutate({ action: "revoke_take", takeId });
  };

  const guide = snapshot?.guide;
  const roleName = snapshot?.myRole === "yellow_dog" ? "黄狗" : "白狗";
  const revision = snapshot?.mySubmission?.revision ?? 0;
  const activeDraft = draft && draft.sessionId === snapshot?.session?.id ? draft : null;
  const choices = activeDraft?.choices ?? snapshot?.mySubmission?.choices ?? {};
  const conflict = Boolean(activeDraft && activeDraft.revision !== revision);
  const changed = JSON.stringify(choices) !== JSON.stringify(snapshot?.mySubmission?.choices ?? {});
  const validChoices = snapshot ? choicesAreReady(snapshot, choices) : false;
  const hasHumanChoice = Object.values(choices).some((choice) => choice.kind === "take");
  const guideReady = guide?.status === "ready" && guide.timeline && guide.timeline.status !== "overflow";
  const setChoice = (lineId: string, value: string) => {
    if (!snapshot?.session) return;
    const updated = { ...choices };
    if (!value) delete updated[lineId];
    else updated[lineId] = value === "ai" ? { kind: "ai" } : { kind: "take", takeId: value };
    setSharingAccepted(false);
    setDraft({ sessionId: snapshot.session.id, revision: activeDraft?.revision ?? revision, choices: updated });
  };
  const submit = async (share: boolean) => {
    if (!snapshot?.session || !validChoices || conflict || (share && !sharingAccepted)) return;
    if (await mutate({ action: "submit", sessionId: snapshot.session.id, expectedRevision: revision, choices, share, shareConsent: share && sharingAccepted })) {
      setDraft(null);
      setSharingAccepted(false);
    }
  };
  const createRender = async (mode: "solo" | "duet") => {
    if (!snapshot?.session || !canLeaveRecording()) return;
    if (await mutate({ action: "render", sessionId: snapshot.session.id, mode })) {
      setRecordingLineId(null);
      setTab("renders");
    }
  };

  return (
    <section ref={area} aria-label="角色配音工作台" className={embedded ? `${styles.theater} space-y-4 p-4 sm:p-5` : "space-y-5 rounded-3xl border border-rose-100 bg-[#fffafa] p-5 text-stone-800 sm:p-6"}>
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div><p className="mb-1 text-[10px] font-medium uppercase tracking-[0.18em] text-amber-800">Puppy rehearsal</p><h3 className="text-lg font-semibold">给小狗配上你的声音</h3><p className="mt-1 text-xs leading-relaxed text-stone-600">{snapshot ? `你的角色是${roleName} · 西语对白，中文辅助` : "先听示范，再和对方分别录制自己的台词。"}</p></div>
        <div className="flex items-center gap-3"><Link href="/recordings" onClick={(event) => { if (!canLeaveRecording()) event.preventDefault(); }} className="text-xs text-stone-600 underline underline-offset-4">我的录音</Link><button type="button" disabled={saving} onClick={() => { setError(null); void load(); }} className={button}>刷新进度</button></div>
      </header>
      {embedded ? <nav aria-label="配音步骤" className={styles.tabs}>{([
        ["guide", "听示范"], ["record", "我来配音"], ["renders", "我的成片"],
      ] as const).map(([value, label], index) => <button key={value} type="button" aria-current={tab === value ? "step" : undefined} onClick={() => changeTab(value)} className={tab === value ? styles.activeTab : styles.tab}><span className={styles.stepNumber}>{index + 1}</span>{label}{value === "renders" && snapshot?.renders.length ? <span className={styles.count}>{snapshot.renders.length}</span> : null}</button>)}</nav> : null}
      {loading ? <p role="status" className="text-sm text-stone-600">正在读取配音进度…</p> : null}
      {error ? <p role="alert" className="rounded-xl bg-rose-50 p-3 text-sm leading-relaxed text-rose-800">{error}</p> : null}
      {snapshot && !snapshot.capabilities.enabled ? <p role="status" className="rounded-xl bg-stone-100 p-3 text-xs leading-relaxed text-stone-700">角色配音暂未启用；已有录音仍可在“我的录音”管理和撤回。</p> : null}
      {snapshot?.capabilities.ttsMode === "disabled" && !guide ? <p role="status" className="rounded-xl bg-stone-100 p-3 text-xs leading-relaxed text-stone-700">语音服务尚未配置，暂时不能制作有声示范。</p> : null}
      {guide?.synthetic || snapshot?.capabilities.ttsMode === "mock" ? <p role="status" className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs leading-relaxed text-amber-950">本地测试模式：示范声音是合成提示音，不是西语朗读，不用于发音学习。不会调用付费语音服务。</p> : null}

      {showGuide && snapshot && !guide ? <div className="rounded-2xl bg-white p-4"><p className="text-sm leading-relaxed text-stone-600">先制作逐句示范，确认两只小狗的台词与朗读时间，再开始录音。不改变原来的画面。</p><button type="button" disabled={busy || snapshot.capabilities.ttsMode === "disabled"} onClick={() => void mutate({ action: "prepare" })} className={`${pinkButton} mt-3`}>制作有声示范</button></div> : null}
      {guide && ["queued", "running"].includes(guide.status) ? <p role="status" className="rounded-2xl bg-white p-4 text-sm text-stone-600">{guide.status === "queued" ? "示范已排队，等待媒体服务处理。" : "正在制作逐句示范与时间窗口。"} 任务保存在后台，离开页面后可回来查看。</p> : null}
      {guide?.status === "failed" ? <div className="rounded-2xl bg-white p-4"><p className="text-sm text-rose-800">{dubbingFailureLabel(guide.errorCode)}</p>{guide.errorCode !== "TTS_DELIVERY_UNKNOWN" ? <button type="button" disabled={busy} onClick={() => void mutate({ action: "retry", kind: "guide", targetId: guide.id })} className={`${button} mt-3`}>重试示范</button> : null}</div> : null}
      {guide?.status === "revoked" ? <p className="text-sm text-rose-800">此示范已撤回，不能继续录音，请创建新的排练。</p> : null}
      {guide?.status === "awaiting_confirmation" && guide.timeline ? <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4"><p className="text-sm leading-relaxed">完整台词需要片尾画面停留 {(guide.timeline.extensionMs / 1000).toFixed(1)} 秒，总长约 {(guide.timeline.durationMs / 1000).toFixed(1)} 秒。确认后按这个固定窗口录音。</p>{guide.createdBy === snapshot?.userId && guide.timelineDigest ? <button type="button" disabled={busy} onClick={() => void mutate({ action: "confirm_duration", guideId: guide.id, timelineDigest: guide.timelineDigest })} className={`${button} mt-3`}>同意片尾停留，继续制作</button> : <p className="mt-2 text-xs text-stone-600">等待示范创建者确认时长。</p>}</div> : null}

      {showGuide && guideReady && guide && safeStudioMediaUrl(guide.videoUrl) ? <div>{embedded ? <div className="rounded-2xl border border-rose-100 bg-white p-4"><div className="flex items-center justify-between gap-3"><div><p className="text-sm font-medium">示范已准备好</p><p className="mt-1 text-xs text-stone-600">{snapshot?.plan.lines.length} 句对白 · 约 {((guide.timeline?.durationMs ?? 0) / 1000).toFixed(1)} 秒</p></div><button type="button" onClick={() => setSelectedPlayback("guide")} className={button}>在剧场看示范</button></div></div> : <RefreshingVideo src={safeStudioMediaUrl(guide.videoUrl)!} subtitleUrl={safeStudioMediaUrl(guide.subtitleUrl)} onRefresh={refreshMedia} className="max-h-80 w-full rounded-2xl bg-stone-950" />}<p className="mt-2 text-xs text-stone-500">示范版始终保留。字幕来自保存剧本，不是录音转写。</p></div> : null}
      {showGuide && embedded && guideReady ? <button type="button" onClick={() => changeTab("record")} className={pinkButton}>示范听好了，我来配音</button> : null}
      {showRecording && !guideReady ? <div className="rounded-2xl border border-rose-100 bg-white p-4"><h4 className="text-sm font-medium">先准备好每句的示范</h4><p className="mt-2 text-xs leading-relaxed text-stone-600">确认有声示范与朗读窗口后，就可以逐句录音。现在不会打开麦克风。</p>{embedded ? <button type="button" onClick={() => changeTab("guide")} className={`${button} mt-3`}>回到听示范</button> : null}</div> : null}
      {showRecording && guideReady && !snapshot?.session ? <button type="button" disabled={busy} onClick={() => void mutate({ action: "session", guideId: guide!.id })} className={pinkButton}>准备我的录音会话</button> : null}

      <div hidden={!auditionLabel}><p className="mb-2 text-xs text-stone-600">{auditionLabel}</p><audio ref={audition} controls preload="none" className="h-10 w-full" /></div>
      {snapshot && (showGuide || showRecording) ? <ol className="space-y-3">{snapshot.plan.lines.filter((line) => showGuide || line.speakerKey === snapshot.myRole).map((line) => {
        const mine = line.dubbable && line.speakerKey === snapshot.myRole;
        const timelineLine = guide?.timeline?.lines.find((entry) => entry.lineId === line.lineId);
        const ownTakes = snapshot.takes.filter((take) => take.lineId === line.lineId && take.ownerId === snapshot.userId);
        const sharedTakes = snapshot.takes.filter((take) => take.lineId === line.lineId && take.ownerId !== snapshot.userId && take.status === "ready");
        const selected = choices[line.lineId];
        return <li key={line.lineId} className="rounded-2xl border border-rose-100 bg-white p-4">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-xs"><span className="font-medium">{line.speakerKey === "yellow_dog" ? "黄狗" : line.speakerKey === "white_dog" ? "白狗" : "NPC"} · {mine ? "我的台词" : line.dubbable ? "对方的台词" : "保留 AI 示范"}</span>{timelineLine ? <span className="text-stone-500">窗口 {(timelineLine.windowMs / 1000).toFixed(1)} 秒</span> : null}</div>
          <p lang="es" className="text-sm font-medium leading-relaxed">{line.text}</p>{line.translation ? <p className="mt-1 text-xs leading-relaxed text-stone-600">{line.translation}</p> : null}
          <div className="mt-3 flex flex-wrap gap-2">{guideReady && safeStudioMediaUrl(guide?.lineAudioUrls?.[line.lineId]) ? <button type="button" onClick={() => void listen((current) => current.guide?.lineAudioUrls?.[line.lineId], `示范 · ${line.text}`)} className={button}>听示范</button> : null}{showRecording && mine && guideReady && snapshot.session && timelineLine ? <button type="button" disabled={busy} onClick={() => openRecorder(line.lineId)} className={button}>{recordingLineId === line.lineId ? "收起录音" : "录这一句"}</button> : null}</div>
          {showRecording && mine && guideReady && snapshot.session && timelineLine ? <div className="mt-3 space-y-3">
            {recordingLineId === line.lineId ? <RoleRecorder key={`${snapshot.session.id}:${line.lineId}`} lineId={line.lineId} text={line.text} translation={line.translation} windowMs={timelineLine.windowMs} disabled={busy} onRecordStart={pauseMedia} onSave={(upload) => uploadTake(line.lineId, upload)} /> : null}
            {ownTakes.map((take) => <DubbingTakeCard key={take.id} take={take} windowMs={timelineLine.windowMs} busy={busy} canRevoke={!saving} onRefresh={refreshMedia} onRevoke={revoke} onRetry={(takeId) => void mutate({ action: "retry", kind: "validate_take", targetId: takeId })} onTrim={async (takeId, trimStartMs, trimEndMs) => { await mutate({ action: "trim", takeId, trimStartMs, trimEndMs }); }} />)}
            <label className="block text-xs text-stone-600">这句使用什么声音？<select disabled={busy} value={selected?.kind === "ai" ? "ai" : selected?.kind === "take" ? selected.takeId : ""} onChange={(event) => setChoice(line.lineId, event.target.value)} className="mt-1 block w-full rounded-xl border border-rose-200 bg-white px-3 py-2 text-sm"><option value="">请选择，不会自动补齐</option><option value="ai">这句保留 AI 示范</option>{ownTakes.filter((take) => take.status === "ready").map((take) => <option key={take.id} value={take.id}>我的录音 {take.id.slice(0, 8)} · {((take.durationMs ?? 0) / 1000).toFixed(1)} 秒</option>)}</select></label>
          </div> : null}
          {!mine ? sharedTakes.map((take) => safeStudioMediaUrl(take.audioUrl) ? <button key={take.id} type="button" onClick={() => void listen((current) => current.takes.find((entry) => entry.id === take.id)?.audioUrl, `伴侣已提交的录音 ${take.id.slice(0, 8)}`)} className={`${button} mt-3`}>听伴侣已提交的版本 {take.id.slice(0, 8)}</button> : null) : null}
        </li>;
      })}</ol> : null}

      {showRecording && snapshot?.session && guideReady ? <section aria-label="提交配音选择" className="rounded-2xl border border-rose-100 p-4">
        <h4 className="text-sm font-semibold">我的声音清单</h4>
        <p className="mt-2 text-xs leading-relaxed text-stone-600">每句都要明确选择。只保存选择不会分享新的私人录音；以前已分享的声音不会因此撤回，请使用对应录音的撤回按钮。提交给伴侣后，合成仍需另行确认版本。</p>
        {conflict ? <div role="alert" className="mt-3 text-xs text-rose-800">保存版本已变化，请先读取当前选择，避免覆盖。<button type="button" onClick={() => { setDraft(null); setSharingAccepted(false); }} className="ml-2 underline">读取当前选择</button></div> : null}
        <div className="mt-3 flex flex-wrap gap-2"><button type="button" disabled={busy || !validChoices || conflict} onClick={() => void submit(false)} className={button}>保存我的选择（不分享）</button></div>
        <label htmlFor={sharingId} className="mt-4 flex items-start gap-2 text-xs leading-relaxed"><input id={sharingId} type="checkbox" checked={sharingAccepted} onChange={(event) => setSharingAccepted(event.target.checked)} className="mt-0.5 accent-rose-500" /><span>我同意将本次选中的录音分享给当前空间的原参与者。不用于声音克隆或发音评分。</span></label>
        <button type="button" disabled={busy || !validChoices || conflict || !sharingAccepted} onClick={() => void submit(true)} className={`${pinkButton} mt-3`}>提交给伴侣</button>
        <p className="mt-3 text-xs text-stone-600">对方已准备 {snapshot.partnerProgress.ready} / {snapshot.partnerProgress.total} 句。{revision > 0 ? `我的已保存清单版本：${revision}。` : "我的选择尚未保存。"}{changed ? "有尚未保存的新选择。" : ""}</p>
        <div className="mt-4 flex flex-wrap gap-2"><button type="button" disabled={busy || !snapshot.mySubmission || !hasHumanChoice || changed || conflict} onClick={() => void createRender("solo")} className={button}>创建我的练习版清单</button><button type="button" disabled={busy || !snapshot.mySubmission?.shared || !hasHumanChoice || changed || conflict} onClick={() => void createRender("duet")} className={button}>创建双人配音清单</button></div>
        <p className="mt-2 text-xs leading-relaxed text-stone-500">每位真人参与者至少使用一句自己的录音。清单生成后逐一确认，才会开始合成。</p>
      </section> : null}
      {showRenders && snapshot?.renders.length ? <section aria-label="成片版本" className="space-y-3"><h4 className="text-sm font-semibold">成片版本</h4>{snapshot.renders.map((render) => <DubbingRenderCard key={`${render.id}:${render.manifestDigest}`} render={render} plan={snapshot.plan} userId={snapshot.userId} synthetic={Boolean(guide?.synthetic)} busy={busy} onRefresh={refreshMedia} onPreview={embedded ? () => setSelectedPlayback(render.id) : undefined} onDownload={(renderId, kind) => void download(renderId, kind)} onConsent={(renderId, manifestDigest) => void mutate({ action: "consent", renderId, manifestDigest, accepted: true })} onCancel={(renderId) => void mutate({ action: "cancel_render", renderId })} onRetry={(renderId) => void mutate({ action: "retry", kind: "render", targetId: renderId })} />)}</section> : null}
      {embedded && showRenders && !snapshot?.renders.length ? <div className="rounded-2xl border border-rose-100 bg-white p-5"><h4 className="text-sm font-medium">还没有配音成片</h4><p className="mt-2 text-xs leading-relaxed text-stone-600">录好自己的台词后，可以先做单人练习。两个人都提交并确认声音清单，就能合成双人版。</p><button type="button" onClick={() => changeTab("record")} className={`${pinkButton} mt-4`}>去录我的台词</button></div> : null}
    </section>
  );
}

function readResponseError(body: unknown): string {
  if (body && typeof body === "object" && "error" in body && typeof body.error === "string") return body.error;
  return "操作未完成，请刷新状态后重试。";
}
