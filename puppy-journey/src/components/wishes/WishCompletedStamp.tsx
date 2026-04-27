"use client";

import { motion } from "framer-motion";
import { useId } from "react";
import { cn } from "@/lib/utils";

/**
 * 「心愿达成」盖章：下落压印 + SVG 噪点位移毛边 + 颗粒纹理 + 飞墨点
 */
export function WishCompletedStamp({ className }: { className?: string }) {
  const rawId = useId().replace(/:/g, "");
  const filterId = `wish-stamp-rough-${rawId}`;

  return (
    <motion.div
      className={cn("pointer-events-none absolute inset-0 z-[3] flex items-center justify-center p-4", className)}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.12 }}
    >
      <svg className="pointer-events-none absolute h-0 w-0 overflow-hidden" aria-hidden>
        <defs>
          <filter id={filterId} x="-40%" y="-40%" width="180%" height="180%">
            <feTurbulence type="fractalNoise" baseFrequency="0.11" numOctaves="4" seed="7" result="noise" />
            <feDisplacementMap in="SourceGraphic" in2="noise" scale="5" xChannelSelector="R" yChannelSelector="G" />
          </filter>
        </defs>
      </svg>

      <motion.div
        className="absolute h-28 w-28 rounded-full bg-pink-400/25 blur-2xl"
        initial={{ scale: 0.15, opacity: 0 }}
        animate={{ scale: [0.2, 1.35, 1.05], opacity: [0, 0.5, 0.2] }}
        transition={{ duration: 0.55, times: [0, 0.5, 1], ease: "easeOut" }}
      />

      <motion.div
        className="relative"
        initial={{ y: -120, rotate: -40, scale: 0.22, opacity: 0 }}
        animate={{
          y: [-120, 20, -5, 0],
          rotate: [-32, -17, -14, -15],
          scale: [0.22, 1.2, 0.95, 1],
          opacity: [0, 1, 1, 1],
        }}
        transition={{
          duration: 0.58,
          times: [0, 0.52, 0.76, 1],
          ease: [0.25, 0.9, 0.3, 1],
        }}
        style={{
          filter: `url(#${filterId}) drop-shadow(0 10px 22px rgba(219, 39, 119, 0.45))`,
        }}
      >
        <div
          className={cn(
            "relative overflow-visible border-[3.5px] border-dashed border-pink-500 bg-gradient-to-br from-pink-50 via-white to-pink-100/90 px-5 py-2.5",
            "text-sm font-black tracking-[0.25em] text-pink-600",
            "ring-2 ring-pink-300/70 ring-offset-2 ring-offset-white/20",
          )}
          style={{
            clipPath: "polygon(2% 4%, 98% 2%, 99% 96%, 4% 98%)",
            boxShadow: "inset 0 2px 0 rgba(255,255,255,0.85), 3px 4px 0 rgba(190,24,93,0.12)",
          }}
        >
          <span className="relative z-[1] drop-shadow-sm">心愿达成</span>
          <span
            className="pointer-events-none absolute inset-0 opacity-50 mix-blend-multiply"
            style={{
              backgroundImage:
                "radial-gradient(circle at 20% 30%, rgba(0,0,0,0.07) 1.2px, transparent 1.2px), radial-gradient(circle, rgba(0,0,0,0.05) 1px, transparent 1px)",
              backgroundSize: "5px 6px, 3px 3px",
            }}
          />
        </div>

        {[0, 1, 2].map((i) => (
          <motion.span
            key={i}
            className="absolute rounded-full bg-pink-400/85"
            style={{
              width: 4 + i,
              height: 4 + i,
              left: "50%",
              top: "50%",
              marginLeft: -2,
              marginTop: -2,
            }}
            initial={{ opacity: 0, scale: 0, x: 0, y: 0 }}
            animate={{
              opacity: [0, 1, 0],
              scale: [0, 1.1, 0.5],
              x: (i - 1) * 36,
              y: -18 - i * 14,
            }}
            transition={{ delay: 0.42 + i * 0.05, duration: 0.42, ease: "easeOut" }}
          />
        ))}
      </motion.div>
    </motion.div>
  );
}
