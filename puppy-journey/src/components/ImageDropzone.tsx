"use client";

import { useCallback, useId, type ChangeEvent, type DragEvent } from "react";
import { UploadCloud } from "lucide-react";

import { cn } from "@/lib/utils";

export type ImageDropzoneProps = {
  className?: string;
  disabled?: boolean;
  multiple?: boolean;
  /** 本次最多交给上层几个文件（多选时截断） */
  maxPick?: number;
  /** 与原生 input accept 一致；建议用 `image/*` 避免部分浏览器对长列表解析异常 */
  accept?: string;
  /** 父组件处理校验与入库；单文件时仍传 length=1 的数组 */
  onFilesSelected: (files: File[]) => void;
  hint?: string;
  title?: string;
};

/**
 * 拖拽/点击上传区域。
 * 使用 label + htmlFor 关联 file input（与 3 月下旬稳定版一致）。
 */
export function ImageDropzone({
  className,
  disabled,
  multiple = false,
  maxPick = 10,
  accept = "image/*",
  onFilesSelected,
  hint = "支持 JPG/PNG，建议正脸清晰、人像占比高",
  title = "拖拽/点击上传照片",
}: ImageDropzoneProps) {
  const inputId = useId();

  const emit = useCallback(
    (list: File[]) => {
      const arr = Array.from(list);
      const slice = multiple ? arr.slice(0, Math.max(0, maxPick)) : arr.slice(0, 1);
      if (slice.length) onFilesSelected(slice);
    },
    [maxPick, multiple, onFilesSelected],
  );

  const onChange = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      const input = e.target;
      // 必须先拷贝 File 数组再清空 value；部分浏览器清空 input 后 FileList 会失效，导致上层永远收不到文件
      const picked = input.files?.length ? Array.from(input.files) : [];
      input.value = "";
      if (!picked.length) return;
      emit(picked);
    },
    [emit],
  );

  const onDrop = useCallback(
    (e: DragEvent<HTMLLabelElement>) => {
      e.preventDefault();
      e.stopPropagation();
      if (disabled) return;
      const files = e.dataTransfer.files;
      if (files?.length) emit(Array.from(files));
    },
    [disabled, emit],
  );

  return (
    <>
      <input
        id={inputId}
        type="file"
        accept={accept}
        multiple={multiple}
        className="sr-only"
        disabled={disabled}
        onChange={onChange}
      />
      <label
        htmlFor={inputId}
        onDragOver={(e) => {
          e.preventDefault();
          e.stopPropagation();
        }}
        onDrop={onDrop}
        className={cn(
          "mt-3 flex w-full cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border border-dashed bg-background/60 px-4 py-6 text-center transition-colors",
          "hover:bg-accent/60",
          disabled && "pointer-events-none cursor-not-allowed opacity-50",
          className,
        )}
      >
        <UploadCloud className="h-7 w-7 text-muted-foreground" />
        <div className="text-sm font-medium">{title}</div>
        <div className="text-xs text-muted-foreground">{hint}</div>
      </label>
    </>
  );
}
