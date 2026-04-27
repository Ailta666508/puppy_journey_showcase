"use client";

import { ImageOff, Trash2 } from "lucide-react";

import { normalizePhotoUrls } from "@/lib/normalizePhotoUrls";
import { ROLE_INFO, isUserRole } from "@/lib/userRole";
import { useAppStore, type AppState, type TravelLog } from "@/store/useAppStore";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";

export function TravelTimeline(props: { className?: string }) {
  const logs = useAppStore((s: AppState) => s.travelLogs);
  const remove = useAppStore((s: AppState) => s.removeTravelLog);

  return (
    <Card className={cn("pj-card p-6 sm:p-8", props.className)}>
      <div className="flex items-baseline justify-between gap-3">
        <div>
          <div className="text-xs font-medium text-muted-foreground">Timeline</div>
          <div className="mt-1 text-lg font-semibold tracking-tight">旅行时间线</div>
        </div>
        <Badge variant="secondary" className="tabular-nums">
          {logs.length} 条
        </Badge>
      </div>

      <Separator className="my-5" />

      {logs.length === 0 ? (
        <div className="rounded-2xl border bg-muted/25 p-6 text-sm text-muted-foreground">
          还没有旅行记录。先在左侧新增一条吧。
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {logs.map((log: TravelLog) => {
            const displayPhotos = normalizePhotoUrls(log.photoUrls);
            return (
            <div key={log.id} className="rounded-2xl border bg-background p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="truncate text-base font-semibold">{log.title}</div>
                    <Badge variant="outline" className="tabular-nums">
                      {log.date}
                    </Badge>
                    {log.authorRole != null && isUserRole(log.authorRole) ? (
                      <Badge variant="secondary" className="font-normal">
                        {ROLE_INFO[log.authorRole].label}
                      </Badge>
                    ) : null}
                    {log.locationText ? <Badge variant="secondary">{log.locationText}</Badge> : null}
                  </div>
                  {log.note ? (
                    <div className="mt-2 whitespace-pre-wrap text-sm text-muted-foreground">
                      {log.note}
                    </div>
                  ) : null}
                </div>
                {log.mine === true ? (
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => void remove(log.id)}
                    title="删除"
                    type="button"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                ) : null}
              </div>

              {displayPhotos.length > 0 ? (
                <div className="mt-4 grid grid-cols-3 gap-2 sm:grid-cols-5">
                  {displayPhotos.slice(0, 10).map((src, i) => (
                    <a
                      key={`${log.id}-${i}`}
                      href={src}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="relative block aspect-square overflow-hidden rounded-xl border bg-muted outline-none ring-offset-2 focus-visible:ring-2 focus-visible:ring-primary"
                      title="点击查看原图"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={src} alt="" className="h-full w-full cursor-pointer object-cover" />
                    </a>
                  ))}
                </div>
              ) : (
                <div className="mt-4 flex items-start gap-3 rounded-xl border border-dashed bg-muted/30 px-3 py-3 text-sm text-muted-foreground">
                  <ImageOff className="mt-0.5 h-4 w-4 shrink-0 opacity-70" aria-hidden />
                  <div>
                    <div className="font-medium text-foreground/90">本条暂无图片预览</div>
                    <p className="mt-1 text-xs leading-relaxed">
                      若你刚保存过带图记录：多为数据库 <code className="rounded bg-muted px-1">photo_urls</code>{" "}
                      未正确写回。刷新后若仍无图，请检查该列与 RLS；上传成功的图片均应有公开 URL。
                    </p>
                  </div>
                </div>
              )}
            </div>
          );
          })}
        </div>
      )}
    </Card>
  );
}

