"use client";

import confetti from "canvas-confetti";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { applyCoupleMeToStore, applyProfileRoleToStore } from "@/lib/syncViewerRole";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";
import { ensureAnonymousSession } from "@/lib/supabase/ensureAnonymousSession";
import { getApiErrorField } from "@/lib/getErrorMessage";
import { cn } from "@/lib/utils";

function formatCoupleApiError(j: { error?: unknown; hint?: string }) {
  const msg = getApiErrorField(j.error, "操作失败");
  const h = j.hint?.trim();
  return h ? `${msg}\n\n详情：${h}` : msg;
}

type MeResponse = {
  ok: boolean;
  error?: string;
  hint?: string;
  partnerProfileId?: string | null;
  profile?: { id?: string; role: string | null; couple_id: string | null };
  couple?: {
    id?: string;
    invite_code: string;
    yellow_dog_id: string | null;
    white_dog_id: string | null;
    complete: boolean;
  } | null;
};

const POLL_MS = 2000;

async function authFetch(path: string, init: RequestInit & { accessToken: string }) {
  const { accessToken, ...rest } = init;
  return fetch(path, {
    ...rest,
    headers: {
      ...rest.headers,
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
  });
}

export default function OnboardingPage() {
  const router = useRouter();
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [inviteCode, setInviteCode] = useState("");
  const [myInvite, setMyInvite] = useState<string | null>(null);
  const [errorDialog, setErrorDialog] = useState<string | null>(null);
  const [finishing, setFinishing] = useState(false);
  const celebrated = useRef(false);

  const celebrateAndGoHome = useCallback(() => {
    if (celebrated.current) return;
    celebrated.current = true;
    setFinishing(true);
    setLoading(false);
    void confetti({ particleCount: 140, spread: 72, origin: { y: 0.65 } });
    setTimeout(() => {
      void confetti({ particleCount: 80, angle: 60, spread: 55, origin: { x: 0, y: 0.65 } });
      void confetti({ particleCount: 80, angle: 120, spread: 55, origin: { x: 1, y: 0.65 } });
    }, 320);
    setTimeout(() => router.replace("/"), 2200);
  }, [router]);

  const loadMe = useCallback(
    async (token: string): Promise<MeResponse> => {
      const res = await authFetch("/api/couple/me", { method: "GET", accessToken: token });
      return (await res.json()) as MeResponse;
    },
    [],
  );

  const bootstrap = useCallback(async () => {
    setLoading(true);
    try {
      const supabase = getSupabaseBrowserClient();
      const session = await ensureAnonymousSession(supabase);
      const token = session?.access_token;
      if (!token) {
        setErrorDialog(
          "无法创建匿名会话。请在 Supabase 控制台 → Authentication → Providers 中开启「Anonymous（匿名）」登录，并检查 NEXT_PUBLIC_SUPABASE_* 配置。",
        );
        return;
      }
      setAccessToken(token);
      const j = await loadMe(token);
      if (!j.ok) {
        setErrorDialog(formatCoupleApiError(j));
        return;
      }
      applyCoupleMeToStore({
        profile: j.profile,
        partnerProfileId: j.partnerProfileId ?? null,
        couple: j.couple?.id ? { id: j.couple.id } : null,
      });
      if (j.couple?.complete) {
        celebrateAndGoHome();
        return;
      }
      if (j.profile?.couple_id && j.couple) {
        setStep(3);
        setMyInvite(j.couple.invite_code);
      } else if (j.profile?.role) {
        setStep(2);
      } else {
        setStep(1);
      }
    } finally {
      setLoading(false);
    }
  }, [celebrateAndGoHome, loadMe]);

  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  useEffect(() => {
    if (step !== 3 || !accessToken) return;
    const t = setInterval(() => {
      void (async () => {
        const j = await loadMe(accessToken);
        if (j.ok && j.couple?.complete) celebrateAndGoHome();
      })();
    }, POLL_MS);
    return () => clearInterval(t);
  }, [step, accessToken, loadMe, celebrateAndGoHome]);

  async function pickRole(role: "yellow_dog" | "white_dog") {
    if (!accessToken) return;
    setBusy(true);
    setErrorDialog(null);
    try {
      const res = await authFetch("/api/couple/set-role", {
        method: "POST",
        accessToken,
        body: JSON.stringify({ role }),
      });
      const j = (await res.json()) as { ok?: boolean; error?: string; hint?: string };
      if (!res.ok || !j.ok) {
        setErrorDialog(formatCoupleApiError(j));
        return;
      }
      applyProfileRoleToStore(role);
      setStep(2);
    } finally {
      setBusy(false);
    }
  }

  async function createRoom() {
    if (!accessToken) return;
    setBusy(true);
    setErrorDialog(null);
    try {
      const res = await authFetch("/api/couple/create-room", {
        method: "POST",
        accessToken,
        body: JSON.stringify({}),
      });
      const j = (await res.json()) as { ok?: boolean; invite_code?: string; error?: string; hint?: string };
      if (!res.ok || !j.ok) {
        setErrorDialog(formatCoupleApiError(j));
        return;
      }
      setMyInvite(j.invite_code ?? null);
      setStep(3);
    } finally {
      setBusy(false);
    }
  }

  async function leaveRoom() {
    if (!accessToken) return;
    const ok = window.confirm(
      "确定退出当前情侣房间？本设备将解除绑定，可重新选角或加入新房间；对方若仍在房间内不受影响。",
    );
    if (!ok) return;
    setBusy(true);
    setErrorDialog(null);
    try {
      const res = await fetch("/api/couple/leave", {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const j = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !j.ok) {
        setErrorDialog(j.error || "退出失败");
        return;
      }
      await bootstrap();
    } finally {
      setBusy(false);
    }
  }

  async function joinRoom() {
    if (!accessToken) return;
    const raw = inviteCode.trim();
    if (raw.replace(/[^A-Za-z0-9]/g, "").length !== 6) {
      setErrorDialog("请输入 6 位邀请码");
      return;
    }
    setBusy(true);
    setErrorDialog(null);
    try {
      const res = await authFetch("/api/couple/join", {
        method: "POST",
        accessToken,
        body: JSON.stringify({ invite_code: raw }),
      });
      const j = (await res.json()) as { ok?: boolean; complete?: boolean; error?: string; hint?: string };
      if (!res.ok || !j.ok) {
        setErrorDialog(formatCoupleApiError(j));
        return;
      }
      if (j.complete) {
        celebrateAndGoHome();
      } else {
        setStep(3);
        const me = await loadMe(accessToken);
        if (me.ok && me.couple?.invite_code) setMyInvite(me.couple.invite_code);
      }
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <div className="bg-background flex min-h-dvh items-center justify-center text-sm text-muted-foreground">
        加载中…
      </div>
    );
  }

  if (finishing) {
    return (
      <div className="from-background via-rose-50/50 to-amber-50/40 flex min-h-dvh flex-col items-center justify-center bg-gradient-to-b p-6 text-center">
        <p className="font-map text-foreground text-2xl font-semibold">配对成功！</p>
        <p className="text-muted-foreground mt-2 text-sm">正在进入主页…</p>
      </div>
    );
  }

  return (
    <div className="from-background via-rose-50/40 to-amber-50/35 flex min-h-dvh flex-col items-center justify-center bg-gradient-to-b p-4">
      <Dialog open={Boolean(errorDialog)} onOpenChange={(o) => !o && setErrorDialog(null)}>
        <DialogContent showCloseButton>
          <DialogHeader>
            <DialogTitle>提示</DialogTitle>
            <DialogDescription className="text-foreground max-h-[50vh] overflow-y-auto whitespace-pre-wrap break-words text-left">
              {errorDialog}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" onClick={() => setErrorDialog(null)}>
              知道了
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {step === 1 ? (
        <div className="w-full max-w-lg space-y-6 text-center">
          <h1 className="font-map text-foreground text-2xl font-semibold tracking-tight">
            欢迎来到专属情侣空间
          </h1>
          <p className="text-muted-foreground text-sm">请选择你的身份。</p>
          <div className="grid gap-4 sm:grid-cols-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => void pickRole("yellow_dog")}
              className={cn(
                "group rounded-2xl border-2 border-transparent bg-card p-0 text-left shadow-md ring-rose-200/60 transition hover:ring-2",
                "focus-visible:ring-ring focus-visible:outline-none focus-visible:ring-2",
              )}
            >
              <Card className="overflow-hidden border-0 shadow-none">
                <div className="relative aspect-square w-full bg-muted/30">
                  <Image
                    src="/onboarding/yellow.png"
                    alt="小鸡毛"
                    fill
                    className="object-cover"
                    sizes="(max-width: 640px) 100vw, 50vw"
                    priority
                  />
                </div>
                <CardContent className="p-4 text-center">
                  <span className="font-map text-lg font-semibold">我是小鸡毛</span>
                </CardContent>
              </Card>
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void pickRole("white_dog")}
              className={cn(
                "group rounded-2xl border-2 border-transparent bg-card p-0 text-left shadow-md ring-sky-200/60 transition hover:ring-2",
                "focus-visible:ring-ring focus-visible:outline-none focus-visible:ring-2",
              )}
            >
              <Card className="overflow-hidden border-0 shadow-none">
                <div className="relative aspect-square w-full bg-muted/30">
                  <Image
                    src="/onboarding/white.png"
                    alt="小白"
                    fill
                    className="object-cover"
                    sizes="(max-width: 640px) 100vw, 50vw"
                    priority
                  />
                </div>
                <CardContent className="p-4 text-center">
                  <span className="font-map text-lg font-semibold">我是小白</span>
                </CardContent>
              </Card>
            </button>
          </div>
        </div>
      ) : null}

      {step === 2 ? (
        <div className="w-full max-w-md space-y-6">
          <div className="text-center">
            <h2 className="font-map text-xl font-semibold">创建或加入房间</h2>
            <p className="text-muted-foreground mt-1 text-sm">创建房间会生成 6 位邀请码；另一半输入邀请码加入。</p>
          </div>
          <div className="flex flex-col gap-3">
            <Button type="button" size="lg" className="w-full" disabled={busy} onClick={() => void createRoom()}>
              创建房间
            </Button>
            <div className="space-y-2 rounded-xl border bg-card/80 p-4 shadow-sm">
              <Label htmlFor="invite">输入邀请码</Label>
              <Input
                id="invite"
                placeholder="例如 AB12CD"
                maxLength={12}
                value={inviteCode}
                onChange={(e) => setInviteCode(e.target.value.toUpperCase())}
                className="font-mono text-lg tracking-widest"
              />
              <Button type="button" variant="secondary" className="w-full" disabled={busy} onClick={() => void joinRoom()}>
                加入房间
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      {step === 3 ? (
        <div className="w-full max-w-md space-y-6 text-center">
          <h2 className="font-map text-xl font-semibold">等待另一半</h2>
          <p className="text-muted-foreground text-sm">
            小鸡毛与小白都进入房间后，将自动进入主页。
          </p>
          {myInvite ? (
            <div className="rounded-2xl border bg-card p-6 shadow-sm">
              <p className="text-muted-foreground text-xs uppercase tracking-wider">你的邀请码</p>
              <p className="font-mono text-foreground mt-2 text-3xl font-bold tracking-[0.35em]">{myInvite}</p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="mt-4"
                onClick={() => void navigator.clipboard.writeText(myInvite)}
              >
                复制邀请码
              </Button>
            </div>
          ) : (
            <p className="text-muted-foreground text-sm">已加入房间，等待对方…</p>
          )}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="text-muted-foreground mt-4"
            disabled={busy}
            onClick={() => void leaveRoom()}
          >
            退出房间，重新选角验证
          </Button>
        </div>
      ) : null}

      <div className="mt-10">
        <Link href="/" className={buttonVariants({ variant: "ghost", size: "sm" })}>
          返回首页
        </Link>
      </div>
    </div>
  );
}
