"use client";

import { AnimatePresence, motion } from "framer-motion";

export type FloatingEmojiItem = { id: string; emoji: string };

type Props = {
  items: FloatingEmojiItem[];
  onDone: (id: string) => void;
};

/**
 * 全屏边缘飘过的 Emoji（占位动效）
 */
export function FloatingEmojiLayer({ items, onDone }: Props) {
  return (
    <div className="pointer-events-none fixed inset-0 z-[120] overflow-hidden">
      <AnimatePresence>
        {items.map((item, index) => (
          <motion.span
            key={item.id}
            className="absolute text-4xl"
            initial={{
              left: `${-5 + (index % 3) * 8}%`,
              top: `${40 + (index % 2) * 15}%`,
              opacity: 0,
              scale: 0.6,
            }}
            animate={{
              left: ["0%", "45%", "95%"],
              top: [`${35 + index * 5}%`, `${25 + index * 8}%`, `${20 + index * 4}%`],
              opacity: [0, 1, 1, 0],
              scale: [0.6, 1.1, 1, 0.8],
              rotate: [0, 12, -8, 20],
            }}
            transition={{ duration: 3.2, ease: "easeInOut" }}
            onAnimationComplete={() => onDone(item.id)}
          >
            {item.emoji}
          </motion.span>
        ))}
      </AnimatePresence>
    </div>
  );
}
