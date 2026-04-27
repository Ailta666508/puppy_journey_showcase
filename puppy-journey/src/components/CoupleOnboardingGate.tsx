"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";

import { applyCoupleMeToStore } from "@/lib/syncViewerRole";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";
import { ensureAnonymousSession } from "@/lib/supabase/ensureAnonymousSession";

const SKIP_PREFIXES = ["/onboarding"];

/**
 * 自动匿名登录（无需邮箱），情侣空间未凑齐时除引导页外一律进入 /onboarding。
 */
export function CoupleOnboardingGate({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  useEffect(() => {
    if (!pathname) return;
    if (SKIP_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`))) return;

    let cancelled = false;

    (async () => {
      try {
        const supabase = getSupabaseBrowserClient();
        const session = await ensureAnonymousSession(supabase);
        if (!session?.access_token || cancelled) return;

        const res = await fetch("/api/couple/me", {
          headers: { Authorization: `Bearer ${session.access_token}` },
        });
        const j = (await res.json()) as {
          ok?: boolean;
          profile?: { id?: string; role?: string | null };
          partnerProfileId?: string | null;
          couple?: { id?: string; complete?: boolean } | null;
        };
        if (cancelled || !j.ok) return;

        applyCoupleMeToStore({
          profile: j.profile,
          partnerProfileId: j.partnerProfileId ?? null,
          couple: j.couple?.id ? { id: j.couple.id } : null,
        });

        const complete = j.couple?.complete === true;
        if (!complete) {
          router.replace("/onboarding");
        }
      } catch {
        /* 无 Supabase 环境或网络错误时不拦截 */
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [pathname, router]);

  return <>{children}</>;
}
