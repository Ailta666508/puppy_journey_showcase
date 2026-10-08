"use client";

import Link from "next/link";
import { Fragment, useEffect, useState, type ReactNode } from "react";

import { getSupabaseBrowserClient } from "@/lib/supabase/browser";

export function DubbingAuthBoundary({ children, presentation = "standalone" }: { children: (authUserId: string) => ReactNode; presentation?: "standalone" | "theater" }) {
  const [auth, setAuth] = useState<{ loaded: boolean; userId: string | null }>({ loaded: false, userId: null });

  useEffect(() => {
    let active = true;
    let revision = 0;
    let unsubscribe: (() => void) | undefined;
    const initialize = async () => {
      try {
        const client = getSupabaseBrowserClient();
        const { data } = client.auth.onAuthStateChange((_event, session) => {
          revision += 1;
          if (active) setAuth({ loaded: true, userId: session?.user.id ?? null });
        });
        unsubscribe = () => data.subscription.unsubscribe();
        const requestedRevision = revision;
        const session = await client.auth.getSession();
        if (active && requestedRevision === revision) setAuth({ loaded: true, userId: session.data.session?.user.id ?? null });
      } catch {
        if (active) setAuth({ loaded: true, userId: null });
      }
    };
    void initialize();
    return () => { active = false; unsubscribe?.(); };
  }, []);

  const messageClass = presentation === "theater" ? "p-6 text-sm text-slate-200" : "text-sm text-stone-600";
  if (!auth.loaded) return <p role="status" className={messageClass}>正在确认账号…</p>;
  if (!auth.userId) return <p className={messageClass}>请先<Link href="/login" className={presentation === "theater" ? "mx-1 text-rose-200 underline underline-offset-4" : "mx-1 text-rose-800 underline underline-offset-4"}>登录</Link>后使用配音或管理自己的录音。</p>;
  return <Fragment key={auth.userId}>{children(auth.userId)}</Fragment>;
}
