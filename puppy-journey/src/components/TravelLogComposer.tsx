"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { Loader2, X } from "lucide-react";

import { ImageDropzone } from "@/components/ImageDropzone";
import { LocalUploadPreviewImage } from "@/components/LocalUploadPreviewImage";
import { isImageFile } from "@/lib/isImageFile";
import { useAppStore, type AppState } from "@/store/useAppStore";
import { uploadTravelPhotoFile } from "@/lib/clientUploadTravelPhoto";
import { getErrorMessage } from "@/lib/getErrorMessage";
import { MAX_TRAVEL_INLINE_FILE_BYTES } from "@/lib/travelPhotoItems";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

function formatDateInput(d: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

const MAX_PHOTOS = 10;
const MAX_FILE_BYTES = MAX_TRAVEL_INLINE_FILE_BYTES;

type PendingPhoto = { id: string; previewUrl: string; file: File };

function assertNonEmptyPhotoUrls(urls: string[]): void {
  if (urls.some((u) => typeof u !== "string" || u.trim().length === 0)) {
    throw new Error("存在空图片数据，请移除该缩略图后重新选择");
  }
}

export function TravelLogComposer(props: { className?: string }) {
  const addTravelLog = useAppStore((s: AppState) => s.addTravelLog);

  const [title, setTitle] = useState("");
  const [date, setDate] = useState(() => formatDateInput(new Date()));
  const [locationText, setLocationText] = useState("");
  const [note, setNote] = useState("");
  const [pendingPhotos, setPendingPhotos] = useState<PendingPhoto[]>([]);
  const pendingPhotosRef = useRef<PendingPhoto[]>([]);
  pendingPhotosRef.current = pendingPhotos;

  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);

  const [uploadHint, setUploadHint] = useState<string | null>(null);
  const [hintIsError, setHintIsError] = useState(false);

  const canSubmit = useMemo(() => {
    if (!date.trim()) return false;
    if (title.trim().length > 0) return true;
    if (locationText.trim().length > 0 || note.trim().length > 0) return true;
    return pendingPhotos.length > 0;
  }, [date, title, locationText, note, pendingPhotos.length]);

  const clear = useCallback(() => {
    setPendingPhotos((prev) => {
      for (const p of prev) {
        URL.revokeObjectURL(p.previewUrl);
      }
      return [];
    });
    setTitle("");
    setDate(formatDateInput(new Date()));
    setLocationText("");
    setNote("");
    setUploadHint(null);
    setHintIsError(false);
  }, []);

  const addFiles = useCallback((files: FileList | File[]) => {
    setUploadHint(null);
    setHintIsError(false);
    const list = Array.from(files);
    console.log("[TravelLogComposer] addFiles: 收到选择", {
      count: list.length,
      names: list.map((f) => f.name),
    });
    const toAdd: PendingPhoto[] = [];
    let skipped = 0;
    const room = Math.max(0, MAX_PHOTOS - pendingPhotosRef.current.length);
    if (room <= 0) {
      setUploadHint(`已达到 ${MAX_PHOTOS} 张上限，请先删除部分照片。`);
      setHintIsError(false);
      return;
    }

    for (const file of list) {
      if (toAdd.length >= room) break;
      console.log("选中的文件:", file, {
        name: file.name,
        size: file.size,
        type: file.type,
        isImage: isImageFile(file),
        underLimit: file.size <= MAX_FILE_BYTES,
      });
      if (!isImageFile(file)) {
        skipped++;
        continue;
      }
      if (file.size > MAX_FILE_BYTES) {
        skipped++;
        continue;
      }
      toAdd.push({
        id: crypto.randomUUID(),
        previewUrl: URL.createObjectURL(file),
        file,
      });
    }

    if (toAdd.length > 0) {
      setPendingPhotos((prev) => {
        const cap = Math.max(0, MAX_PHOTOS - prev.length);
        const slice = toAdd.slice(0, cap);
        const next = [...prev, ...slice];
        console.log("[TravelLogComposer] addFiles: 写入 pendingPhotos", {
          prevCount: prev.length,
          added: slice.length,
          nextCount: next.length,
        });
        return next;
      });
    }

    if (skipped > 0) {
      setUploadHint(`有 ${skipped} 个文件未加入（非图片或过大），已加入 ${toAdd.length} 张。`);
      setHintIsError(toAdd.length === 0);
    }
  }, []);

  const removePhoto = useCallback((id: string) => {
    setPendingPhotos((prev) => {
      const target = prev.find((p) => p.id === id);
      if (target) URL.revokeObjectURL(target.previewUrl);
      return prev.filter((p) => p.id !== id);
    });
  }, []);

  const handleSave = useCallback(async () => {
    // ref 在每次 render 末尾与 state 同步；点击时用 ref 保证与 DOM 已展示的 pending 列表一致
    const snapshot = pendingPhotosRef.current.slice();
    console.log("[TravelLogComposer] handleSave STEP1 入口", {
      canSubmit,
      savingLocked: savingRef.current,
      snapshotCount: snapshot.length,
      statePendingCount: pendingPhotos.length,
      date: date.trim() || "(empty)",
      titleLen: title.trim().length,
    });

    if (!canSubmit) {
      console.warn("[TravelLogComposer] handleSave ABORT: !canSubmit（按钮本应 disabled，若仍触发请检查表单/事件冒泡）");
      return;
    }
    if (savingRef.current) {
      console.warn("[TravelLogComposer] handleSave ABORT: savingRef 已锁住（重复提交）");
      return;
    }

    savingRef.current = true;
    setSaving(true);
    setUploadHint(null);
    setHintIsError(false);
    try {
      const count = snapshot.length;
      const photoUrls: string[] = [];

      console.log("[TravelLogComposer] handleSave STEP2 开始上传", { count, endpoint: "/api/travel-logs/upload-photo" });

      for (let i = 0; i < count; i++) {
        const p = snapshot[i]!;
        const file = p.file;
        console.log(`[TravelLogComposer] handleSave STEP2-upload ${i + 1}/${count}`, {
          name: file.name,
          size: file.size,
          type: file.type,
        });
        setUploadHint(
          `正在上传第 ${i + 1}/${count} 张到 Storage（原文件直传，不经 Base64 JSON）…`,
        );
        const url = await uploadTravelPhotoFile({ file });
        console.log(`[TravelLogComposer] handleSave STEP2-done ${i + 1}/${count}`, { url: url?.slice?.(0, 80) });
        photoUrls.push(url);
      }

      if (count > 0) {
        if (photoUrls.length !== count) {
          throw new Error("上传结果数量与照片不一致，请重试");
        }
        assertNonEmptyPhotoUrls(photoUrls);
      }

      const payload = {
        title: title.trim() || (count > 0 ? "旅行随拍" : "旅行记录"),
        date,
        locationText: locationText.trim() || undefined,
        note: note.trim() || undefined,
        photoUrls,
      };
      console.log("[TravelLogComposer] handleSave STEP3 保存日记 POST /api/travel-logs", {
        ...payload,
        photoUrlsCount: payload.photoUrls.length,
      });

      await addTravelLog(payload);
      console.log("[TravelLogComposer] handleSave STEP4 完成并已清空表单");
      clear();
    } catch (e) {
      console.error("[TravelLogComposer] handleSave ERROR", e);
      setHintIsError(true);
      setUploadHint(getErrorMessage(e));
    } finally {
      savingRef.current = false;
      setSaving(false);
      console.log("[TravelLogComposer] handleSave FINALLY savingRef 已释放");
    }
  }, [
    addTravelLog,
    canSubmit,
    clear,
    date,
    locationText,
    note,
    pendingPhotos,
    title,
  ]);

  return (
    <Card className={cn("pj-card p-6 sm:p-8", props.className)}>
      <div className="flex items-baseline justify-between gap-3">
        <div>
          <div className="text-xs font-medium text-muted-foreground">Travel Journal</div>
          <div className="mt-1 text-lg font-semibold tracking-tight">新增旅行记录</div>
        </div>
      </div>

      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        <div className="grid gap-2">
          <Label htmlFor="title">标题（可不填，有照片时会用「旅行随拍」）</Label>
          <Input
            id="title"
            value={title}
            placeholder="例如：巴塞罗那的海风"
            onChange={(e) => setTitle(e.target.value)}
          />
        </div>

        <div className="grid gap-2">
          <Label htmlFor="date">日期</Label>
          <Input id="date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>

        <div className="grid gap-2 sm:col-span-2">
          <Label htmlFor="location">地点（可选）</Label>
          <Input
            id="location"
            value={locationText}
            placeholder="例如：Spain · Barcelona"
            onChange={(e) => setLocationText(e.target.value)}
          />
        </div>

        <div className="grid gap-2 sm:col-span-2">
          <Label htmlFor="note">旅行随笔（可选）</Label>
          <Textarea
            id="note"
            value={note}
            placeholder="写下今天的一个瞬间：海鲜饭、街角的吉他声、迷路的那 15 分钟……"
            onChange={(e) => setNote(e.target.value)}
            className="min-h-28"
          />
        </div>

        <div className="grid gap-2 sm:col-span-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Label className="text-base font-medium">照片</Label>
            <span className="text-xs text-muted-foreground">
              至多 {MAX_PHOTOS} 张 · 单张 ≤{Math.round(MAX_FILE_BYTES / (1024 * 1024))}MB
            </span>
          </div>

          <ImageDropzone
            className="mt-0"
            disabled={pendingPhotos.length >= MAX_PHOTOS || saving}
            multiple
            maxPick={Math.max(0, MAX_PHOTOS - pendingPhotos.length)}
            accept="image/*"
            onFilesSelected={addFiles}
            title="拖拽/点击选择照片"
            hint="保存时用表单直传原图到 Storage，再写入旅行日志（绕过 JSON+Base64 体积限制）"
          />

          {pendingPhotos.length > 0 ? (
            <div className="rounded-xl border border-primary/20 bg-primary/5 px-3 py-3 dark:border-primary/30 dark:bg-primary/10">
              <div className="text-sm font-medium text-foreground">已选 {pendingPhotos.length} 张（与 Q
              版生成器一样，会先在这里显示本地预览）</div>
              <p className="mt-1 text-xs text-muted-foreground">
                提交后按顺序上传至 Storage，再写入时间线。请填好日期后点「
                <strong className="text-foreground">保存到时间线</strong>」。
              </p>
            </div>
          ) : null}

          {uploadHint ? (
            <p
              className={cn(
                "text-xs",
                hintIsError ? "text-destructive" : "text-amber-800 dark:text-amber-200",
              )}
            >
              {uploadHint}
            </p>
          ) : null}

          {pendingPhotos.length > 0 ? (
            <div className="mt-3 rounded-xl border bg-card/50 p-3">
              <div className="mb-2 text-xs font-medium text-muted-foreground">本地预览 · 未保存前仅在你的浏览器中</div>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
                {pendingPhotos.map((p) => (
                  <div key={p.id} className="min-w-0">
                    <div className="group relative aspect-square overflow-hidden rounded-xl border bg-muted shadow-sm">
                      <LocalUploadPreviewImage
                        src={p.previewUrl}
                        alt={p.file.name || "待上传图片"}
                      />
                      <button
                        type="button"
                        className="absolute right-1 top-1 rounded-full bg-background/90 p-1 shadow ring-1 ring-border opacity-90 transition hover:bg-destructive/15"
                        onClick={() => removePhoto(p.id)}
                        title="移除"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                    <p
                      className="mt-1.5 truncate text-center text-[11px] text-muted-foreground"
                      title={p.file.name}
                    >
                      {p.file.name || "未命名"}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      </div>

      <div className="mt-6 flex flex-wrap gap-2">
        <Button
          type="button"
          disabled={!canSubmit || saving}
          onClick={() => {
            void handleSave();
          }}
          className="pj-btn-gradient"
        >
          {saving ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 shrink-0 animate-spin" />
              正在保存…
            </>
          ) : (
            "保存到时间线"
          )}
        </Button>
        <Button variant="secondary" onClick={clear} type="button" disabled={saving}>
          清空
        </Button>
      </div>

      <div className="mt-4 text-xs text-muted-foreground">
        每张图以 multipart 原文件上传（约为文件大小，无 Base64 膨胀），最后只把公开 URL 数组写入{" "}
        <code className="rounded bg-muted px-1">travel_logs.photo_urls</code>。
      </div>
    </Card>
  );
}
