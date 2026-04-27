"use client";

import { AnimatePresence, motion } from "framer-motion";
import Image from "next/image";
import { useCallback, useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { DEFAULT_PIPELINE_IMAGE_CONTEXT_ZH } from "@/lib/pipeline/prompts";
import type { LessonScript } from "@/lib/pipeline/types";
import { getApiErrorField, getErrorMessage } from "@/lib/getErrorMessage";
import { normalizePhotoUrls } from "@/lib/normalizePhotoUrls";
import { supabaseBearerHeaders } from "@/lib/supabase/apiSessionHeaders";
import { cn } from "@/lib/utils";
import { useAppStore, type AppState, type TravelLog } from "@/store/useAppStore";

/** 剧场实景（投屏区占位） */
const THEATER_IMG = "/rehearsal/theater.png";
/** 看电影小狗插画，每分钟轮换 */
const DOG_CYCLE = ["/rehearsal/dogs-1.png", "/rehearsal/dogs-2.png", "/rehearsal/dogs-3.png"] as const;

const DOG_ROTATE_MS = 60_000;
/** 演示用「假播放」时长（无真实 videoUrl 时） */
const DEMO_PLAY_MS = 12_000;

const DEFAULT_USER_TEXT = "白狗想去海边，白狗想吃鱼，黄狗想喝饮料。";

function buildDiaryPromptFromLog(log: TravelLog): string {
  const parts: string[] = [];
  if (log.title?.trim()) parts.push(`标题：${log.title.trim()}`);
  if (log.date?.trim()) parts.push(`旅行日期：${log.date.trim()}`);
  if (log.locationText?.trim()) parts.push(`地点：${log.locationText.trim()}`);
  if (log.note?.trim()) parts.push(`随笔：${log.note.trim()}`);
  return parts.length > 0 ? parts.join("\n") : DEFAULT_USER_TEXT;
}

type Phase = "lobby" | "cinema" | "vocab";

const DEMO_VOCAB_CARDS = [
  { es: "café", zh: "咖啡", ex: "Un café con leche, por favor." },
  { es: "cortado", zh: "可塔朵（浓缩加少量奶）", ex: "Y un cortado para mí, gracias." },
  { es: "tomar", zh: "喝；点（饮料）", ex: "¿Qué van a tomar?" },
  { es: "leche", zh: "牛奶", ex: "con leche" },
  { es: "gracias", zh: "谢谢", ex: "Gracias." },
  { es: "por favor", zh: "请", ex: "Un café con leche, por favor." },
  { es: "hola", zh: "你好", ex: "¡Hola!" },
  { es: "menú", zh: "菜单", ex: "¿Puede traer el menú?" },
] as const;

/** 图生视频常需数分钟；总等待约 10 分钟 */
const POLL_INTERVAL_MS = 2_000;
const POLL_MAX_ATTEMPTS = 300;

export function RehearsalTheaterView() {
  const userId = useAppStore((s: AppState) => s.currentUserRole);
  const [latestTravelLog, setLatestTravelLog] = useState<TravelLog | null>(null);
  const [travelLogLoading, setTravelLogLoading] = useState(true);
  const [travelLogFetchError, setTravelLogFetchError] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>("lobby");
  const [dogIdx, setDogIdx] = useState(0);
  const [helpOpen, setHelpOpen] = useState(false);
  const [sosSentence, setSosSentence] = useState("Un café con leche, por favor.");
  const [sosLoading, setSosLoading] = useState(false);
  const [sosText, setSosText] = useState<string | null>(null);

  const [userText, setUserText] = useState(DEFAULT_USER_TEXT);
  /** 无真实旅行图且未手传图时：可选用默认「烧烤」场景说明（仅文案侧，不走多模态） */
  const [useDefaultSceneText, setUseDefaultSceneText] = useState(true);
  const [imageDataUrl, setImageDataUrl] = useState<string | null>(null);

  const [pipelineLoading, setPipelineLoading] = useState(false);
  const [pipelineStep, setPipelineStep] = useState("");
  const [pipelineError, setPipelineError] = useState<string | null>(null);
  const [script, setScript] = useState<LessonScript | null>(null);
  const [keyImageUrl, setKeyImageUrl] = useState<string | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);

  const [playing, setPlaying] = useState(false);
  const [playProgress, setPlayProgress] = useState(0);
  const playStartRef = useRef<number | null>(null);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    setTravelLogLoading(true);
    setTravelLogFetchError(null);
    void (async () => {
      try {
        const headers = await supabaseBearerHeaders();
        const res = await fetch("/api/travel-logs", {
          cache: "no-store",
          headers: { ...headers },
        });
        let data: { ok?: boolean; travelLogs?: TravelLog[]; error?: unknown };
        try {
          data = (await res.json()) as typeof data;
        } catch {
          if (!cancelled) {
            setTravelLogFetchError("旅行日记接口返回无效");
            setTravelLogLoading(false);
          }
          return;
        }
        if (cancelled) return;
        if (!res.ok || !data.ok || !Array.isArray(data.travelLogs)) {
          setTravelLogFetchError(getApiErrorField(data.error, "拉取旅行日记失败"));
          setLatestTravelLog(null);
          setTravelLogLoading(false);
          return;
        }
        const latest = data.travelLogs[0] ?? null;
        setLatestTravelLog(latest);
        if (latest) {
          setUserText(buildDiaryPromptFromLog(latest));
          setUseDefaultSceneText(false);
        }
      } catch (e) {
        if (!cancelled) setTravelLogFetchError(getErrorMessage(e));
      } finally {
        if (!cancelled) setTravelLogLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [userId]);

  useEffect(() => {
    if (phase !== "lobby") return;
    const id = window.setInterval(() => {
      setDogIdx((i) => (i + 1) % DOG_CYCLE.length);
    }, DOG_ROTATE_MS);
    return () => window.clearInterval(id);
  }, [phase]);

  const stopPlayLoop = useCallback(() => {
    if (rafRef.current != null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    playStartRef.current = null;
  }, []);

  useEffect(() => {
    if (phase !== "cinema") {
      setPlaying(false);
      setPlayProgress(0);
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      playStartRef.current = null;
    }
  }, [phase]);

  useEffect(() => {
    if (videoUrl || !playing) {
      stopPlayLoop();
      return;
    }
    playStartRef.current = performance.now();
    const tick = (now: number) => {
      const start = playStartRef.current;
      if (start == null) return;
      const t = Math.min(1, (now - start) / DEMO_PLAY_MS);
      setPlayProgress(t);
      if (t >= 1) {
        setPlaying(false);
        setPlayProgress(0);
        stopPlayLoop();
        setPhase("vocab");
        return;
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      stopPlayLoop();
    };
  }, [playing, stopPlayLoop, videoUrl]);

  const onPickImage = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    if (f.size > 4 * 1024 * 1024) {
      setPipelineError("图片请小于 4MB");
      return;
    }
    setUseDefaultSceneText(false);
    setPipelineError(null);
    const r = new FileReader();
    r.onload = () => {
      setImageDataUrl(typeof r.result === "string" ? r.result : null);
    };
    r.readAsDataURL(f);
  }, []);

  const clearUploadedImage = useCallback(() => {
    setImageDataUrl(null);
    setUseDefaultSceneText(true);
  }, []);

  const runFullPipeline = useCallback(async () => {
    setPipelineError(null);
    setPipelineLoading(true);
    setVideoUrl(null);
    try {
      const fromLogPhotos = latestTravelLog ? normalizePhotoUrls(latestTravelLog.photoUrls as unknown) : [];
      const travelFirstPhoto = fromLogPhotos[0]?.trim() ?? "";
      const effectiveUserImage = (imageDataUrl?.trim() || travelFirstPhoto).trim();
      const imageDescription =
        effectiveUserImage
          ? ""
          : useDefaultSceneText
            ? DEFAULT_PIPELINE_IMAGE_CONTEXT_ZH
            : "（用户未提供旅行照片或参考图，请仅根据上方用户文字创作剧本；可适当推断与旅行相关的场景氛围。）";
      const contextTravel =
        latestTravelLog != null
          ? [
              "【最新一条旅行日记摘要（来自 travel_logs）】",
              buildDiaryPromptFromLog(latestTravelLog),
              latestTravelLog.id ? `记录 id：${latestTravelLog.id}` : "",
            ]
              .filter(Boolean)
              .join("\n")
          : "";

      setPipelineStep("生成剧本（LLM）…");
      const apiHeaders = await supabaseBearerHeaders();
      const scriptRes = await fetch("/api/pipeline/script", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...apiHeaders },
        body: JSON.stringify({
          user_text: userText.trim(),
          image_description: imageDescription,
          user_image_data_url: effectiveUserImage,
          user_image_url: /^https?:\/\//i.test(effectiveUserImage) ? effectiveUserImage : "",
          context_achievements: "",
          context_travel: contextTravel,
          context_wishes: "",
        }),
      });
      const scriptJson = (await scriptRes.json()) as {
        ok?: boolean;
        error?: string;
        script?: LessonScript;
        pipeline_job_id?: string;
      };
      if (!scriptRes.ok || !scriptJson.ok || !scriptJson.script || !scriptJson.pipeline_job_id) {
        throw new Error(getApiErrorField(scriptJson.error, "剧本生成失败"));
      }
      const sc = scriptJson.script;
      const pipelineJobId = scriptJson.pipeline_job_id;
      setScript(sc);

      setPipelineStep("生成关键帧（火山生图）…");
      const imgRes = await fetch("/api/pipeline/image", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...apiHeaders },
        body: JSON.stringify({ pipeline_job_id: pipelineJobId, script: sc }),
      });
      const imgJson = (await imgRes.json()) as { ok?: boolean; error?: string; imageUrl?: string };
      if (!imgRes.ok || !imgJson.ok || !imgJson.imageUrl) {
        throw new Error(getApiErrorField(imgJson.error, "生图失败"));
      }
      setKeyImageUrl(imgJson.imageUrl);

      const frameForVideo = effectiveUserImage.trim();
      setPipelineStep(
        frameForVideo ? "提交视频任务（图生视频 · 旅行实拍首帧）…" : "提交视频任务（文生视频 · 无旅行配图降级）…",
      );
      const vidRes = await fetch("/api/pipeline/video/start", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...apiHeaders },
        body: JSON.stringify({
          pipeline_job_id: pipelineJobId,
          script: sc,
          first_frame_image_url: frameForVideo,
        }),
      });
      const vidJson = (await vidRes.json()) as { ok?: boolean; error?: string; jobId?: string };
      if (!vidRes.ok || !vidJson.ok || !vidJson.jobId) {
        throw new Error(getApiErrorField(vidJson.error, "视频任务提交失败"));
      }

      setPipelineStep("轮询视频状态…");
      let finalUrl: string | undefined;
      for (let i = 0; i < POLL_MAX_ATTEMPTS; i++) {
        await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
        const st = await fetch(`/api/pipeline/jobs/${encodeURIComponent(vidJson.jobId)}`, {
          headers: { ...apiHeaders },
        });
        const stj = (await st.json()) as {
          ok?: boolean;
          error?: unknown;
          status?: string;
          videoUrl?: string;
        };
        if (!st.ok || !stj.ok) throw new Error(getApiErrorField(stj.error, "轮询失败"));
        if (stj.status === "failed") throw new Error(getApiErrorField(stj.error, "视频任务失败"));
        if (stj.status === "completed") {
          if (stj.videoUrl) {
            finalUrl = stj.videoUrl;
            break;
          }
          throw new Error(getApiErrorField(stj.error, "视频已完成但未返回播放地址"));
        }
        if (i % 15 === 0 && i > 0) {
          setPipelineStep(`轮询视频状态…（已等待约 ${Math.round((i * POLL_INTERVAL_MS) / 60_000)} 分钟）`);
        }
      }
      if (!finalUrl) {
        throw new Error(
          "等待视频超时（约 10 分钟）。若方舟仍在排队，可稍后刷新重试；也可在 Network 里查看 /api/pipeline/jobs 的返回。",
        );
      }
      setVideoUrl(finalUrl);
      setPhase("cinema");
    } catch (e) {
      setPipelineError(getErrorMessage(e));
    } finally {
      setPipelineLoading(false);
      setPipelineStep("");
    }
  }, [userText, imageDataUrl, useDefaultSceneText, userId, latestTravelLog]);

  const runSos = useCallback(async () => {
    setSosLoading(true);
    setSosText(null);
    try {
      const res = await fetch("/api/rehearsal/sos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sentence: sosSentence.trim() }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: unknown; text?: string };
      if (!res.ok || !data.ok) throw new Error(getApiErrorField(data.error, `请求失败 ${res.status}`));
      setSosText(data.text ?? "");
    } catch (e) {
      setSosText(getErrorMessage(e));
    } finally {
      setSosLoading(false);
    }
  }, [sosSentence]);

  const resetDemo = useCallback(() => {
    setPhase("lobby");
    setPlaying(false);
    setPlayProgress(0);
    stopPlayLoop();
    setVideoUrl(null);
    setKeyImageUrl(null);
    setScript(null);
    setPipelineError(null);
  }, [stopPlayLoop]);

  const vocabCards =
    script?.script?.map((line, i) => ({
      es: line.text,
      zh: line.translation ?? line.character,
      ex: line.translation ? `${line.text} — ${line.translation}` : line.text,
      key: `${line.id}-${i}`,
    })) ?? null;

  return (
    <div className="flex min-h-[calc(100dvh-3.5rem)] flex-col bg-[#0c1222] text-foreground">
      {phase === "lobby" ? (
        <div className="grid min-h-[calc(100dvh-3.5rem)] flex-1 grid-cols-1 lg:grid-cols-2 lg:divide-x lg:divide-white/10">
          <section className="relative flex min-h-[42vh] flex-col lg:min-h-0">
            <div className="absolute left-0 right-0 top-0 z-10 bg-gradient-to-b from-black/70 to-transparent px-4 py-3">
              <h2 className="text-center text-sm font-semibold tracking-wide text-white/95">剧场</h2>
              <p className="text-center text-[11px] text-white/65">
                {travelLogLoading
                  ? "正在拉取最新旅行日记…"
                  : pipelineStep || (pipelineLoading ? "管线处理中…" : "生成完成后将在放映厅投屏视频")}
              </p>
              {travelLogFetchError ? (
                <p className="mt-1 text-center text-[10px] text-amber-200/90">{travelLogFetchError}（将使用右侧默认文案）</p>
              ) : null}
            </div>
            <div className="relative min-h-[42vh] flex-1 lg:min-h-0">
              <Image
                src={THEATER_IMG}
                alt=""
                fill
                className="object-cover object-center"
                sizes="(max-width: 1024px) 100vw, 50vw"
                priority
              />
              <div
                className="pointer-events-none absolute rounded-md border border-dashed border-white/35 bg-black/25 shadow-inner backdrop-blur-[1px]"
                style={{ top: "11%", left: "6%", right: "6%", height: "44%" }}
              />
              {keyImageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={keyImageUrl}
                  alt=""
                  className="pointer-events-none absolute object-contain"
                  style={{ top: "11%", left: "6%", right: "6%", height: "44%" }}
                />
              ) : null}
              <div className="pointer-events-none absolute left-0 right-0 flex justify-center" style={{ top: "28%" }}>
                <span className="rounded-full bg-black/45 px-3 py-1 text-[11px] text-white/85 ring-1 ring-white/20">
                  {keyImageUrl ? "关键帧预览" : "银幕区域 · 成片将在此播放"}
                </span>
              </div>
            </div>
          </section>

          <section className="relative flex min-h-[42vh] flex-col bg-[#0f172a] lg:min-h-0">
            <div className="absolute left-0 right-0 top-0 z-10 bg-gradient-to-b from-black/60 to-transparent px-4 py-3">
              <h2 className="text-center text-sm font-semibold tracking-wide text-amber-100/95">看电影小狗 · 管线</h2>
              <p className="text-center text-[11px] text-amber-100/65">
                {travelLogLoading
                  ? "同步旅行日记中…"
                  : latestTravelLog
                    ? "已绑定最新 travel_logs；有图则图生视频，无图则文生视频"
                    : "未读到旅行记录时使用演示文案 · 剧本→火山图→视频轮询"}
              </p>
            </div>
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
              <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 pb-3 pt-14">
                <label className="text-xs text-amber-100/80">用户文字（Agent 1 · 可由旅行日记预填）</label>
                <Textarea
                  value={userText}
                  onChange={(e) => setUserText(e.target.value)}
                  rows={4}
                  className="resize-y border-white/15 bg-black/30 text-sm text-white"
                  disabled={travelLogLoading}
                />
                {latestTravelLog && !travelLogLoading ? (
                  <p className="text-[10px] text-amber-100/55">
                    日记首图将优先作为 Agent 1 多模态输入与 Agent 6 视频首帧
                    {normalizePhotoUrls(latestTravelLog.photoUrls as unknown).length === 0
                      ? "（本条无图 → 视频走文生降级）"
                      : ""}
                  </p>
                ) : null}
                <div className="flex flex-col gap-2 rounded-lg border border-white/10 bg-black/25 p-3">
                  <label className="flex cursor-pointer items-center gap-2 text-xs text-amber-100/85">
                    <input
                      type="checkbox"
                      checked={useDefaultSceneText && !imageDataUrl}
                      onChange={(e) => {
                        setUseDefaultSceneText(e.target.checked);
                        if (e.target.checked) setImageDataUrl(null);
                      }}
                      disabled={!!imageDataUrl}
                    />
                    使用默认「夜间烧烤」场景说明（文本）
                  </label>
                  <div className="flex flex-wrap items-center gap-2">
                    <label className="cursor-pointer rounded-md bg-amber-500/20 px-3 py-1.5 text-xs text-amber-100 ring-1 ring-amber-400/40 hover:bg-amber-500/30">
                      上传参考图（多模态）
                      <input type="file" accept="image/*" className="hidden" onChange={onPickImage} />
                    </label>
                    {imageDataUrl ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="text-xs text-white/70"
                        onClick={clearUploadedImage}
                      >
                        清除图片
                      </Button>
                    ) : null}
                  </div>
                  {imageDataUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={imageDataUrl}
                      alt=""
                      className="mt-1 max-h-32 rounded-md object-contain ring-1 ring-white/15"
                      loading="eager"
                      decoding="sync"
                      fetchPriority="high"
                    />
                  ) : null}
                </div>
                {pipelineError ? (
                  <p className="rounded-md border border-red-400/40 bg-red-950/50 px-3 py-2 text-xs text-red-200">{pipelineError}</p>
                ) : null}
              </div>
              <div className="relative flex shrink-0 justify-center px-4 py-3">
                <AnimatePresence mode="wait">
                  <motion.div
                    key={dogIdx}
                    initial={{ opacity: 0, scale: 0.98 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.98 }}
                    transition={{ duration: 0.45 }}
                    className="relative aspect-square w-full max-w-[220px] overflow-hidden rounded-3xl shadow-[0_0_40px_rgba(250,204,21,0.12)] ring-1 ring-amber-400/20 sm:max-w-xs"
                  >
                    <Image
                      src={DOG_CYCLE[dogIdx]!}
                      alt=""
                      fill
                      className="object-cover object-center"
                      sizes="(max-width: 1024px) 90vw, 20rem"
                    />
                  </motion.div>
                </AnimatePresence>
              </div>
              <div className="shrink-0 border-t border-white/10 bg-black/30 px-4 py-4">
                <div className="flex flex-wrap items-center justify-center gap-3">
                  <Button
                    type="button"
                    className="pj-btn-gradient px-6"
                    disabled={pipelineLoading || travelLogLoading}
                    onClick={runFullPipeline}
                  >
                    {pipelineLoading
                      ? pipelineStep || "生成中…"
                      : travelLogLoading
                        ? "正在同步旅行数据…"
                        : "运行全链路并进入放映"}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    className="border-white/25 text-white hover:bg-white/10"
                    onClick={() => setPhase("cinema")}
                  >
                    仅演示放映 UI
                  </Button>
                </div>
              </div>
            </div>
          </section>
        </div>
      ) : null}

      {phase === "cinema" ? (
        <div className="relative flex min-h-[calc(100dvh-3.5rem)] flex-1 flex-col bg-black lg:flex-row">
          <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-4 p-4 lg:p-8">
            <div className="w-full max-w-5xl">
              <div
                className="relative aspect-video w-full overflow-hidden rounded-xl bg-zinc-900 ring-1 ring-white/10"
                onClick={() => {
                  if (!videoUrl && !playing && playProgress === 0) setPlaying(true);
                }}
              >
                {videoUrl ? (
                  <video
                    src={videoUrl}
                    controls
                    playsInline
                    className="h-full w-full bg-black object-contain"
                    poster={keyImageUrl ?? undefined}
                  >
                    您的浏览器不支持视频标签
                  </video>
                ) : (
                  <div className="absolute inset-0 flex flex-col items-center justify-center bg-gradient-to-b from-zinc-900 to-black">
                    {!playing ? (
                      <>
                        <div className="mb-2 rounded-full bg-white/10 p-5 ring-2 ring-amber-300/40">
                          <svg className="h-14 w-14 text-amber-200" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                            <path d="M8 5v14l11-7z" />
                          </svg>
                        </div>
                        <p className="text-sm text-white/70">点击画面开始演示播放（无真实视频）</p>
                        <p className="mt-1 text-xs text-white/45">播放结束后自动展示单词卡片</p>
                      </>
                    ) : (
                      <div className="flex flex-col items-center gap-2">
                        <p className="text-sm font-medium text-amber-100/90">放映中…（演示）</p>
                        <div className="h-1.5 w-48 overflow-hidden rounded-full bg-white/15">
                          <div
                            className="h-full rounded-full bg-amber-400/90 transition-[width] duration-100 ease-linear"
                            style={{ width: `${playProgress * 100}%` }}
                          />
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
            <Button
              type="button"
              variant="outline"
              className="border-white/25 bg-white/5 text-white hover:bg-white/10"
              onClick={resetDemo}
            >
              返回双栏等待页
            </Button>
          </div>

          <aside className="flex flex-row items-center justify-center gap-3 border-t border-white/10 bg-zinc-950/90 p-4 lg:w-36 lg:flex-col lg:border-l lg:border-t-0 lg:py-10">
            <Button
              type="button"
              className="whitespace-nowrap pj-btn-gradient shadow-lg shadow-amber-900/30"
              onClick={() => {
                setSosText(null);
                setHelpOpen(true);
              }}
            >
              帮助小狗
            </Button>
            <p className="max-w-[10rem] text-center text-[10px] leading-snug text-white/45">Agent 7 · 卡壳朗读指导</p>
          </aside>

          <Dialog open={helpOpen} onOpenChange={setHelpOpen}>
            <DialogContent className="sm:max-w-md">
              <DialogHeader>
                <DialogTitle>帮助小狗（Agent 7）</DialogTitle>
                <DialogDescription>输入卡住的西语句子，获取发音与跟读提示。</DialogDescription>
              </DialogHeader>
              <Textarea value={sosSentence} onChange={(e) => setSosSentence(e.target.value)} rows={3} className="resize-y" />
              <div className="flex flex-wrap gap-2">
                <Button type="button" disabled={sosLoading} onClick={runSos}>
                  {sosLoading ? "请求中…" : "获取提示"}
                </Button>
                <Button type="button" variant="outline" onClick={() => setHelpOpen(false)}>
                  关闭
                </Button>
              </div>
              {sosText ? (
                <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded-lg border bg-muted/40 p-3 text-xs">{sosText}</pre>
              ) : null}
            </DialogContent>
          </Dialog>
        </div>
      ) : null}

      {phase === "vocab" ? (
        <div className="flex min-h-[calc(100dvh-3.5rem)] flex-1 flex-col bg-[#FFF9F5]">
          <div className="border-b border-stone-200/80 bg-white/80 px-4 py-4 backdrop-blur-sm">
            <h2 className="text-center text-lg font-semibold text-stone-800">本段排练 · 词汇卡</h2>
            <p className="mt-1 text-center text-xs text-stone-500">
              {vocabCards ? "来自本轮剧本台词" : "演示数据"}
            </p>
            <div className="mt-3 flex justify-center gap-2">
              <Button type="button" variant="outline" size="sm" onClick={resetDemo}>
                回到开场
              </Button>
              <Button
                type="button"
                size="sm"
                className="pj-btn-gradient"
                onClick={() => {
                  setPlayProgress(0);
                  setPlaying(false);
                  setPhase("cinema");
                }}
              >
                再看一遍放映
              </Button>
            </div>
          </div>
          <div className="mx-auto w-full max-w-6xl flex-1 px-4 py-6">
            <div className="columns-1 gap-4 space-y-4 sm:columns-2 lg:columns-3 lg:gap-6">
              {(vocabCards ?? DEMO_VOCAB_CARDS.map((c, i) => ({ ...c, key: `demo-${i}` }))).map((card, i) => (
                <div
                  key={"key" in card ? card.key : i}
                  className={cn(
                    "mb-4 break-inside-avoid rounded-2xl border border-stone-200/90 bg-white p-4 shadow-sm",
                    i % 3 === 0 && "bg-orange-50/90",
                    i % 3 === 1 && "bg-violet-50/90",
                    i % 3 === 2 && "bg-sky-50/90",
                  )}
                >
                  <p className="text-lg font-bold text-stone-900">{card.es}</p>
                  <p className="mt-1 text-sm text-stone-600">{card.zh}</p>
                  <p className="mt-3 border-t border-stone-200/80 pt-2 text-xs italic text-stone-500">{card.ex}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
