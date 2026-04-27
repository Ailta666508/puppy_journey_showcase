"use client";

import { cn } from "@/lib/utils";

type Props = {
  src: string;
  alt?: string;
  className?: string;
};

/**
 * 本地 blob / object URL 待上传预览。
 * 使用原生 img：Next/Image 对 blob: 与部分环境不兼容，易在客户端直接抛错白屏。
 */
export function LocalUploadPreviewImage({ src, alt = "", className }: Props) {
  return (
    // eslint-disable-next-line @next/next/no-img-element -- 仅用于短生命周期 object URL 预览
    <img src={src} alt={alt} className={cn("absolute inset-0 h-full w-full object-cover", className)} />
  );
}
