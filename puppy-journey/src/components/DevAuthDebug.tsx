"use client";

import { useEffect, useState } from "react";

import { getSupabaseBrowserClient } from "@/lib/supabase/browser";
import { userRoleDisplayName } from "@/lib/userRole";

/**
 * 开发环境右下角：当前会话的 role / couple_id（便于双人房间调试）
 */
export function DevAuthDebug() {
  const [text, setText] = useState<string | null>(null);

  useEffect(() => {
    if (process.env.NODE_ENV !== "development") return;

    let cancelled = false;

    (async () => {
      try {
        let supabase: ReturnType<typeof getSupabaseBrowserClient>;
        try {
          supabase = getSupabaseBrowserClient();
        } catch {
          if (!cancelled) setText("缺少 NEXT_PUBLIC_SUPABASE_*");
          return;
        }
        const { data: sessionData } = await supabase.auth.getSession();
        const token = sessionData.session?.access_token;
        if (!token) {
          if (!cancelled) setText("无 session");
          return;
        }
        const res = await fetch("/api/couple/me", {
          headers: { Authorization: `Bearer ${token}` },
        });
        const j = (await res.json()) as {
          ok?: boolean;
          partnerProfileId?: string | null;
          profile?: { role?: string | null; couple_id?: string | null; id?: string };
        };
        if (!j.ok || !j.profile) {
          if (!cancelled) setText("me 接口失败");
          return;
        }
        const { role, couple_id: coupleId, id } = j.profile;
        const roleLabel = role ? userRoleDisplayName(role as "yellow_dog" | "white_dog") : "（未选角）";
        const pid = j.partnerProfileId;
        if (!cancelled) {
          setText(
            `dev · profile: ${id?.slice(0, 8) ?? "?"}…\nrole: ${role ?? "null"} (${roleLabel})\ncouple_id: ${coupleId ?? "null"}\npartner_id: ${pid ? `${pid.slice(0, 8)}…` : "null"}`,
          );
        }
      } catch {
        if (!cancelled) setText("调试信息加载失败");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  if (process.env.NODE_ENV !== "development" || text == null) return null;

  return (
    <div
      className="pointer-events-none fixed bottom-3 left-3 z-[200] max-w-[min(100vw-1.5rem,20rem)] rounded-lg border border-amber-500/40 bg-amber-950/90 px-2 py-1.5 font-mono text-[10px] leading-snug text-amber-100 shadow-lg"
      aria-hidden
    >
      <pre className="whitespace-pre-wrap break-all">{text}</pre>
    </div>
  );
}
