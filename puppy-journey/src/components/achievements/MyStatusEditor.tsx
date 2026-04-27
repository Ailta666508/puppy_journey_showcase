"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Icon } from "@/components/IconManager";
import type { IconName } from "@/components/IconManager";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { getApiErrorField, getErrorMessage } from "@/lib/getErrorMessage";
import type { UserStatusPair } from "./types";
import { STATUS_ICON_OPTIONS } from "./statusIcons";
import { ROLE_INFO } from "@/lib/userRole";
import { useAppStore, type AppState } from "@/store/useAppStore";

type Props = {
  open: boolean;
  presence: UserStatusPair;
  onClose: () => void;
  onSaved: (next: UserStatusPair) => void;
};

/** 仅编辑「我」的状态：文案、图标、悄悄话（状态本身一直由状态岛展示，此处不调悄悄话已读接口） */
export function MyStatusEditor({ open, presence, onClose, onSaved }: Props) {
  const viewerRole = useAppStore((s: AppState) => s.currentUserRole);
  const fixedAvatarSrc = ROLE_INFO[viewerRole].avatarSrc;
  const [statusText, setStatusText] = useState("");
  const [icon, setIcon] = useState<IconName | null>(null);
  const [whisper, setWhisper] = useState("");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    if (!open) return;
    const slot = presence.me;
    setStatusText(slot.statusText);
    setIcon((slot.statusIcon as IconName | null) ?? null);
    setWhisper("");
    setErr("");
  }, [open, presence.me.statusText, presence.me.statusIcon]);

  async function save() {
    setErr("");
    setLoading(true);
    try {
      const { achievementAuthHeaders } = await import("@/lib/achievements/clientAuth");
      const res = await fetch("/api/achievements/presence", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await achievementAuthHeaders()) },
        body: JSON.stringify({
          role: "me",
          statusText: statusText.trim(),
          statusIcon: icon,
          whisper: whisper.trim() || undefined,
          isFocusing: false,
        }),
      });
      const data = (await res.json()) as { ok?: boolean; presence?: UserStatusPair; error?: unknown };
      if (!res.ok || !data.ok || !data.presence)
        throw new Error(getApiErrorField(data.error, "保存失败"));
      onSaved(data.presence);
      onClose();
    } catch (e) {
      setErr(getErrorMessage(e) || "网络错误");
    } finally {
      setLoading(false);
    }
  }

  return (
    <AnimatePresence>
      {open ? (
        <>
          <motion.button
            type="button"
            className="fixed inset-0 z-[95] bg-black/40 backdrop-blur-[2px]"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            aria-label="关闭"
          />
          <motion.div
            role="dialog"
            className="fixed inset-x-0 bottom-0 z-[100] max-h-[88vh] overflow-auto rounded-t-3xl border bg-card px-4 pb-8 pt-5 shadow-2xl"
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={{ type: "spring", damping: 28, stiffness: 320 }}
          >
            <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-muted" />
            <h3 className="text-center text-lg font-semibold">我的状态</h3>
            <p className="mt-1 text-center text-xs text-muted-foreground">状态文案、小图标，以及发给对方的悄悄话</p>

            <div className="mx-auto mt-5 max-w-md space-y-4">
              <div className="grid gap-2">
                <span className="text-sm font-medium">头像</span>
                <div className="flex flex-wrap items-center gap-3">
                  <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-full border bg-white shadow-sm">
                    <img
                      src={fixedAvatarSrc}
                      alt=""
                      className="h-full w-full object-contain p-1"
                      referrerPolicy="no-referrer"
                    />
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    头像由情侣空间角色固定（小鸡毛 / 小白），无需上传。
                  </p>
                </div>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="my-st-text">状态文字</Label>
                <Input id="my-st-text" value={statusText} onChange={(e) => setStatusText(e.target.value)} placeholder="今天的心情…" />
              </div>
              <div className="grid gap-2">
                <span className="text-sm font-medium">状态小图标</span>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => setIcon(null)}
                    className={`rounded-xl border px-3 py-2 text-xs ${icon === null ? "border-primary bg-primary/10" : "border-border"}`}
                  >
                    无
                  </button>
                  {STATUS_ICON_OPTIONS.map((name) => (
                    <button
                      key={name}
                      type="button"
                      onClick={() => setIcon(name)}
                      className={`flex h-10 w-10 items-center justify-center rounded-xl border ${icon === name ? "border-primary bg-primary/10" : "border-border"}`}
                    >
                      <Icon name={name} size={22} />
                    </button>
                  ))}
                </div>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="my-st-whisper">悄悄话（发给对方）</Label>
                <Textarea id="my-st-whisper" value={whisper} onChange={(e) => setWhisper(e.target.value)} placeholder="写一句只有 Ta 能懂的悄悄话…" className="min-h-24" />
              </div>
              {err ? <p className="text-sm text-destructive">{err}</p> : null}
            </div>

            <div className="mx-auto mt-6 flex max-w-md justify-end gap-2">
              <Button type="button" variant="secondary" onClick={onClose}>
                取消
              </Button>
              <Button type="button" className="pj-btn-gradient text-white" disabled={loading} onClick={() => void save()}>
                {loading ? "保存中…" : "保存"}
              </Button>
            </div>
          </motion.div>
        </>
      ) : null}
    </AnimatePresence>
  );
}
