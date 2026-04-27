"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useState } from "react";

import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";
import { applyProfileRoleToStore } from "@/lib/syncViewerRole";
import { userRoleDisplayName } from "@/lib/userRole";
import { useAppStore, type AppState } from "@/store/useAppStore";

const navItems = [
  { href: "/", label: "主页" },
  { href: "/travel", label: "旅行日志" },
  { href: "/achievements", label: "成就" },
  { href: "/wishes", label: "心愿墙" },
  { href: "/learning", label: "未来排练室" },
] as const;

export function TopNav() {
  const pathname = usePathname();
  const router = useRouter();
  const currentUserRole = useAppStore((s: AppState) => s.currentUserRole);
  const clearTravelAndWishes = useAppStore((s: AppState) => s.clearTravelAndWishes);
  const [signingOut, setSigningOut] = useState(false);

  const handleSignOut = useCallback(async () => {
    setSigningOut(true);
    try {
      const supabase = getSupabaseBrowserClient();
      await supabase.auth.signOut();
      clearTravelAndWishes();
      applyProfileRoleToStore(null);
      router.replace("/onboarding");
    } catch {
      setSigningOut(false);
    }
  }, [clearTravelAndWishes, router]);

  return (
    <header className="sticky top-0 z-50 border-b bg-background/60 backdrop-blur supports-[backdrop-filter]:bg-background/50">
      <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-3 px-4 py-3">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <span className="text-sm font-semibold tracking-tight">PuppyJourney</span>
          <Badge variant="secondary" className="hidden sm:inline-flex">
            双宠奇旅
          </Badge>
          <Badge
            variant="outline"
            className="ml-1 inline-flex h-7 max-w-[8rem] shrink-0 items-center truncate rounded-full px-2 text-[10px] font-medium sm:max-w-none sm:px-2.5 sm:text-[11px]"
            title="由情侣空间选角决定：小鸡毛=黄狗视角，小白=白狗视角"
          >
            {userRoleDisplayName(currentUserRole)}视角
          </Badge>
        </div>
        <nav className="flex flex-wrap items-center justify-end gap-1">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 rounded-full border-destructive/40 text-destructive hover:bg-destructive/10"
            disabled={signingOut}
            onClick={() => void handleSignOut()}
          >
            {signingOut ? "退出中…" : "退出登录"}
          </Button>
          <Link
            href="/onboarding"
            className={cn(
              "rounded-full px-3 py-1.5 text-sm transition-colors",
              pathname === "/onboarding" || pathname?.startsWith("/onboarding/")
                ? "pj-btn-gradient"
                : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
            )}
          >
            情侣空间
          </Link>
          {navItems.map((item) => {
            const active =
              pathname === item.href || (item.href !== "/" && pathname?.startsWith(item.href));
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "rounded-full px-3 py-1.5 text-sm transition-colors",
                  active
                    ? "pj-btn-gradient"
                    : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
                )}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
      </div>
    </header>
  );
}

