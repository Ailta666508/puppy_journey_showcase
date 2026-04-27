"use client";

import { useCallback, useMemo, useState } from "react";
import Image from "next/image";
import { Check, Loader2, Wand2, ImageIcon } from "lucide-react";
import { motion } from "framer-motion";

import { ImageDropzone } from "@/components/ImageDropzone";
import { isImageFile } from "@/lib/isImageFile";
import { ensureTravelPhotoPublicUrl } from "@/lib/clientUploadTravelPhoto";
import { getApiErrorField } from "@/lib/getErrorMessage";
import { cn } from "@/lib/utils";
import { useAppStore, type AppState } from "@/store/useAppStore";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

/** 风格对应的完整提示词，仅在后端请求时使用，不展示给用户 */
const PROMPT_MAP: Record<"puppy" | "polaroid", string> = {
  puppy: `你是一位专业的卡通形象生成助手，核心任务是：
1. 严格保留【white.png和yellow.png】的视觉风格：极简黑色粗线条、白色填充、可爱圆润造型、标志性波浪轮廓线。男生使用黄色小狗，女生使用白色小狗。
2. 精准复刻用户上传的肢体动作与姿态，包括：手臂角度、手部姿态、身体朝向、头部角度。
3. 为小狗添加与人物动作匹配的配件（如手机、花枝、书本等），配件风格需与小狗线条感保持一致。
4. 保持与参考人物图一致的画面比例（竖版 9:16 或 1:1），并将小狗自然融入原场景背景中，光影与透视匹配。
5. 小狗尽量直立，如果四肢着地，需优先参考指定re.png的肢体结构。
示例：用户上传图片为lift1.jpg，豆包给的图为example.png`,
  polaroid: `保持原图人物面部特征和主体绝对不变，将背景替换为具有复古氛围的场景。画面必须添加强烈的复古拍立得（Polaroid）胶片质感：暖黄色调、明显的胶片颗粒感（film grain）、轻微漏光。最后将整体画面放置在经典的白色拍立得相纸边框内，底部留白，比例1:1。`,
};

function fileToDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.onload = () => resolve(String(reader.result));
    reader.readAsDataURL(file);
  });
}

function looksLikeImageDataUrl(s: string): boolean {
  const t = s.trimStart();
  if (!t.startsWith("data:")) return false;
  const semi = t.indexOf(";");
  const comma = t.indexOf(",");
  if (semi === -1 || comma === -1 || comma <= semi) return false;
  const mime = t.slice(5, semi).toLowerCase();
  return mime.startsWith("image/");
}

/** 部分浏览器对 HEIC/某些选图结果会给出 application/octet-stream 的 data URL */
function isReadableImageDataUrl(dataUrl: string, file: File): boolean {
  if (looksLikeImageDataUrl(dataUrl)) return true;
  const t = dataUrl.trimStart();
  if (!t.startsWith("data:") || !/;base64,/i.test(t)) return false;
  const m = t.match(/^data:([^;]+);base64,/i);
  const mime = (m?.[1] ?? "").toLowerCase();
  if (mime === "application/octet-stream" && isImageFile(file)) return true;
  return false;
}

export function QAvatarGenerator(props: { className?: string }) {
  const addTravelLog = useAppStore((s: AppState) => s.addTravelLog);

  const [originDataUrl, setOriginDataUrl] = useState<string>("");
  const [resultDataUrl, setResultDataUrl] = useState<string>("");
  const [isLoading, setIsLoading] = useState(false);
  const [readingFile, setReadingFile] = useState(false);
  const [error, setError] = useState<string>("");
  const [saveBusy, setSaveBusy] = useState(false);
  const [selectedMode, setSelectedMode] = useState<"puppy" | "polaroid">("puppy");

  const canGenerate = useMemo(
    () => !!originDataUrl && !isLoading && !readingFile,
    [isLoading, originDataUrl, readingFile],
  );
  const canSave = useMemo(() => !!originDataUrl && !!resultDataUrl && !isLoading, [
    isLoading,
    originDataUrl,
    resultDataUrl,
  ]);

  const pickFile = useCallback(async (file?: File) => {
    setError("");
    setResultDataUrl("");
    if (!file) return;
    const acceptByMimeOrName = isImageFile(file);
    if (!acceptByMimeOrName && file.size === 0) {
      setError("文件为空，请重新选择。");
      return;
    }
    setReadingFile(true);
    try {
      const dataUrl = await fileToDataUrl(file);
      if (!isReadableImageDataUrl(dataUrl, file)) {
        setOriginDataUrl("");
        setError(
          acceptByMimeOrName
            ? "读入的不是可用的图片数据，请换 JPG/PNG/WebP；若为 iPhone HEIC 请先导出为 JPG。"
            : "未识别为图片（MIME 或扩展名异常）。若确实是照片，可先导出为 JPG 再试。",
        );
        return;
      }
      setOriginDataUrl(dataUrl);
      if (!acceptByMimeOrName) {
        setError("");
      }
    } catch {
      setOriginDataUrl("");
      setError("无法读取该图片，请换一张或先转为 JPG/PNG 再试。");
    } finally {
      setReadingFile(false);
    }
  }, []);

  async function generate() {
    if (!originDataUrl || isLoading) return;
    setIsLoading(true);
    setError("");
    setResultDataUrl("");
    try {
      const res = await fetch("/api/generate-q-avatar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          imageBase64: originDataUrl,
          prompt: PROMPT_MAP[selectedMode],
        }),
      });
      const json = (await res.json()) as { ok: boolean; b64?: string; url?: string; error?: unknown };
      if (!res.ok || !json.ok) {
        throw new Error(getApiErrorField(json.error, `请求失败 (${res.status})`));
      }

      if (json.b64) {
        setResultDataUrl(`data:image/png;base64,${json.b64}`);
      } else if (json.url) {
        setResultDataUrl(json.url);
      } else {
        throw new Error("模型未返回图片。");
      }
    } catch (e) {
      setError(getApiErrorField(e, "生成失败"));
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <Card className={cn("pj-card p-6 sm:p-8", props.className)}>
      <div>
        <div className="text-xs font-medium text-muted-foreground">Q 版生成器</div>
      </div>

      <ImageDropzone
        disabled={isLoading || readingFile}
        multiple={false}
        maxPick={1}
        accept="image/*,.heic,.heif"
        onFilesSelected={(files) => {
          const f = files[0];
          if (f) void pickFile(f);
        }}
      />

      <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <ImageIcon className="h-3.5 w-3.5 shrink-0 opacity-80" aria-hidden />
        {readingFile ? (
          <span className="flex items-center gap-1.5 text-amber-800 dark:text-amber-200">
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
            正在读取原图…
          </span>
        ) : originDataUrl ? (
          <span className="font-medium text-foreground">已载入原图，可点击「变身」</span>
        ) : (
          <span>尚未载入原图：选图成功后这里会提示，按钮也会亮起</span>
        )}
      </div>

      {error ? (
        <div className="mt-3 rounded-2xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      ) : null}

      <div className="mt-6">
        <div className="mb-3 text-xs font-medium text-muted-foreground">选择风格</div>
        <div className="grid grid-cols-2 gap-3">
          <motion.button
            type="button"
            onClick={() => setSelectedMode("puppy")}
            onDragStart={(e) => e.preventDefault()}
            whileHover={{ y: -2 }}
            whileTap={{ scale: 0.98 }}
            className={cn(
              "relative flex flex-col items-center justify-center gap-2 rounded-2xl border-2 px-4 py-5 text-center transition-colors",
              selectedMode === "puppy"
                ? "border-orange-400 bg-orange-50/80 shadow-sm ring-2 ring-orange-200 ring-offset-2"
                : "border-border bg-white hover:border-muted-foreground/30 hover:bg-muted/30",
            )}
          >
            {selectedMode === "puppy" && (
              <span className="absolute right-2 top-2 rounded-full bg-orange-400 p-0.5 text-white">
                <Check className="h-3.5 w-3.5" />
              </span>
            )}
            <div className="relative h-12 w-12 select-none">
              <Image
                src="/icons/icon-puppy.png"
                alt=""
                fill
                sizes="48px"
                draggable={false}
                className="object-contain"
              />
            </div>
            <span className="text-sm font-medium">小狗贴贴</span>
            <span className="text-xs text-muted-foreground">可爱线条 · 双人小狗</span>
          </motion.button>

          <motion.button
            type="button"
            onClick={() => setSelectedMode("polaroid")}
            onDragStart={(e) => e.preventDefault()}
            whileHover={{ y: -2 }}
            whileTap={{ scale: 0.98 }}
            className={cn(
              "relative flex flex-col items-center justify-center gap-2 rounded-2xl border-2 px-4 py-5 text-center transition-colors",
              selectedMode === "polaroid"
                ? "border-amber-400 bg-amber-50/80 shadow-sm ring-2 ring-amber-200 ring-offset-2"
                : "border-border bg-white hover:border-muted-foreground/30 hover:bg-muted/30",
            )}
          >
            {selectedMode === "polaroid" && (
              <span className="absolute right-2 top-2 rounded-full bg-amber-400 p-0.5 text-white">
                <Check className="h-3.5 w-3.5" />
              </span>
            )}
            <div className="relative h-12 w-12 select-none">
              <Image
                src="/icons/icon-polaroid.png"
                alt=""
                fill
                sizes="48px"
                draggable={false}
                className="object-contain"
              />
            </div>
            <span className="text-sm font-medium">复古拍立得</span>
            <span className="text-xs text-muted-foreground">胶片质感 · 白边相纸</span>
          </motion.button>
        </div>
      </div>

      {(originDataUrl || resultDataUrl) && (
        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          <div className="rounded-2xl border bg-background/60 p-3">
            <div className="mb-2 text-xs font-medium text-muted-foreground">原图</div>
            {originDataUrl ? (
              <div className="relative aspect-square overflow-hidden rounded-xl bg-muted">
                {/* 原图为本地 data URL：用原生 img，避免部分环境 Next/Image 对 blob/data 的兼容问题 */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={originDataUrl} alt="原图预览" className="h-full w-full object-contain" />
              </div>
            ) : (
              <div className="grid aspect-square place-items-center rounded-xl bg-muted text-xs text-muted-foreground">
                未选择
              </div>
            )}
          </div>

          <div className="rounded-2xl border bg-background/60 p-3">
            <div className="mb-2 flex items-center justify-between gap-3">
              <div className="text-xs font-medium text-muted-foreground">Q 版结果</div>
              {isLoading ? (
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
                  {selectedMode === "puppy" ? "小臭狗画画中" : "小臭狗拍照中"}
                </div>
              ) : null}
            </div>

            {resultDataUrl ? (
              <div className="relative aspect-square overflow-hidden rounded-xl bg-muted">
                {resultDataUrl.startsWith("http") ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={resultDataUrl}
                    alt="q-avatar"
                    className="h-full w-full object-contain"
                    loading="eager"
                    decoding="sync"
                    fetchPriority="high"
                  />
                ) : (
                  <Image
                    src={resultDataUrl}
                    alt="q-avatar"
                    fill
                    className="object-contain"
                    unoptimized
                    priority
                  />
                )}
              </div>
            ) : (
              <div className="grid aspect-square place-items-center rounded-xl bg-muted text-xs text-muted-foreground">
                还未生成
              </div>
            )}
          </div>
        </div>
      )}

      <div className="mt-6 flex flex-wrap gap-2">
        <Button
          disabled={!canGenerate}
          title={
            !originDataUrl
              ? readingFile
                ? "正在读取图片"
                : "请先在上方的区域选择一张图片，并等待「已载入原图」提示"
              : undefined
          }
          onClick={() => void generate()}
          className="pj-btn-gradient"
          type="button"
        >
          {isLoading ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 shrink-0 animate-spin" />
              {selectedMode === "puppy" ? "小臭狗画画中" : "小臭狗拍照中"}
            </>
          ) : (
            <>
              <Wand2 className="mr-2 h-4 w-4" />
              变身
            </>
          )}
        </Button>

        <Button
          disabled={!canSave || saveBusy}
          variant="secondary"
          type="button"
          onClick={() => {
            if (!originDataUrl || !resultDataUrl || saveBusy) return;
            void (async () => {
              setSaveBusy(true);
              setError("");
              try {
                const photoUrls = await Promise.all([
                  ensureTravelPhotoPublicUrl(originDataUrl, "q-origin.png"),
                  ensureTravelPhotoPublicUrl(resultDataUrl, "q-result.png"),
                ]);
                await addTravelLog({
                  title: "Q版头像生成",
                  date: new Date().toISOString().slice(0, 10),
                  note: "由火山引擎（豆包）视觉大模型生成的 Q 版卡通图。",
                  photoUrls,
                });
                setOriginDataUrl("");
                setResultDataUrl("");
              } catch (e) {
                setError(getApiErrorField(e, "保存失败"));
              } finally {
                setSaveBusy(false);
              }
            })();
          }}
        >
          {saveBusy ? "保存中…" : "保存到时间线"}
        </Button>
      </div>

      <p className="mt-4 text-xs text-muted-foreground">
        保存时原图与 Q 版会先上传到 Supabase Storage，数据库里存公开图片 URL；保存后出现在下方时间线。
      </p>
    </Card>
  );
}

