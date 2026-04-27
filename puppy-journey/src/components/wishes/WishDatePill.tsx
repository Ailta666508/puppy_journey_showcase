"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { formatWishPillCompact } from "@/lib/wishDateFormat";
import { WISH_DASHED, WISH_PILL_BG, wishStyleSeed } from "@/lib/wishCardStyle";

type Props = {
  wishDate: string;
  /** 用于配色轮换，列表用 item.id，表单可用固定值 */
  colorSeed: string;
  showConnectorBelow?: boolean;
  className?: string;
};

/** 时间轴左侧：日期胶囊 yyyy.M.d 竖排，字号随容器收缩（偏小以适配窄胶囊） */
export function WishDatePill({ wishDate, colorSeed, showConnectorBelow, className }: Props) {
  const seed = wishStyleSeed(colorSeed);
  const pill = WISH_PILL_BG[seed % WISH_PILL_BG.length]!;
  const dashed = WISH_DASHED[seed % WISH_DASHED.length]!;
  const label = formatWishPillCompact(wishDate);

  const boxRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLSpanElement>(null);
  const [fontPx, setFontPx] = useState(8);

  useLayoutEffect(() => {
    function fit() {
      const b = boxRef.current;
      const t = textRef.current;
      if (!b || !t) return;
      const w = b.clientWidth;
      const h = b.clientHeight;
      if (w < 4 || h < 4) return;

      let lo = 5;
      let hi = 11;
      let best = lo;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        t.style.fontSize = `${mid}px`;
        const ok = t.scrollWidth <= w && t.scrollHeight <= h;
        if (ok) {
          best = mid;
          lo = mid + 1;
        } else {
          hi = mid - 1;
        }
      }
      setFontPx(best);
    }

    fit();
    const ro = new ResizeObserver(fit);
    const box = boxRef.current;
    if (box) ro.observe(box);
    return () => ro.disconnect();
  }, [label]);

  return (
    <div className={cn("flex w-14 shrink-0 flex-col items-center sm:w-16", className)}>
      <div
        ref={boxRef}
        className={cn(
          "flex h-[88px] min-h-[88px] w-11 flex-col items-center justify-center rounded-full px-1 py-2 text-center shadow-md sm:h-[92px] sm:min-h-[92px] sm:w-12",
          pill,
        )}
      >
        <span
          ref={textRef}
          style={{ fontSize: `${fontPx}px` }}
          className="block max-h-full max-w-full px-0.5 text-center font-bold leading-none tracking-tight text-white/95 tabular-nums [text-orientation:mixed] [writing-mode:vertical-rl]"
        >
          {label}
        </span>
      </div>
      {showConnectorBelow ? (
        <div className={cn("mt-1 min-h-8 w-0 flex-1 border-l-2 border-dashed", dashed)} aria-hidden />
      ) : null}
    </div>
  );
}
