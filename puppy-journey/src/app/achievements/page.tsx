"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { TopNav } from "@/components/TopNav";
import { AddAchievementModal } from "@/components/achievements/AddAchievementModal";
import { AddBlindBoxSheet } from "@/components/achievements/AddBlindBoxSheet";
import { FloatingActionButton } from "@/components/achievements/FloatingActionButton";
import { FocusModeModal } from "@/components/achievements/FocusModeModal";
import { MyStatusEditor } from "@/components/achievements/MyStatusEditor";
import { PartnerStatusViewer } from "@/components/achievements/PartnerStatusViewer";
import { StatusIsland } from "@/components/achievements/StatusIsland";
import { TaskBoard } from "@/components/achievements/TaskBoard";
import { UnboxModal } from "@/components/achievements/UnboxModal";
import type {
  AchievementTask,
  BlindBoxState,
  UserStatusPair,
  VoucherType,
} from "@/components/achievements/types";
import { getApiErrorField } from "@/lib/getErrorMessage";
import { applyCoupleMeToStore } from "@/lib/syncViewerRole";

/**
 * 成就页：状态岛 + 双列任务板 + 盲盒 / 专注 / 拆盒流程
 */
export default function AchievementsPage() {
  /**
   * bootstrap / 轮询 与「开始专注」等 presence 写入并发时，较晚返回的旧响应会盖住新状态。
   * 任意一次本地以服务端为准的 presence 更新（专注、保存状态、悄悄话已读）先自增 epoch，
   * 正在进行的拉取若晚于该次更新则不再写入 presence（仍会更新 tasks）。
   */
  const presenceBootstrapEpoch = useRef(0);

  const [userStatus, setUserStatus] = useState<UserStatusPair | null>(null);
  const [tasks, setTasks] = useState<AchievementTask[] | null>(null);
  const [sheetTask, setSheetTask] = useState<AchievementTask | null>(null);
  const [focusTask, setFocusTask] = useState<AchievementTask | null>(null);
  const [unbox, setUnbox] = useState<{
    voucher: VoucherType;
    taskId: string;
    blindBox: BlindBoxState;
  } | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [myStatusOpen, setMyStatusOpen] = useState(false);
  const [partnerViewerOpen, setPartnerViewerOpen] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadErrorStatus, setLoadErrorStatus] = useState<number | null>(null);

  const loadAchievements = useCallback(async (opts?: { silent?: boolean }) => {
    const epochAtFetchStart = presenceBootstrapEpoch.current;
    const { achievementAuthHeaders } = await import("@/lib/achievements/clientAuth");
    const headers = await achievementAuthHeaders();
    const r = await fetch("/api/achievements/bootstrap", {
      cache: "no-store",
      headers: { ...headers },
    });
    const d = (await r.json()) as {
      ok?: boolean;
      error?: unknown;
      tasks?: AchievementTask[];
      presence?: UserStatusPair;
      viewerRole?: string;
      myProfileId?: string;
      partnerProfileId?: string | null;
      coupleId?: string;
    };
    if (d.ok && d.tasks && d.presence) {
      setLoadError(null);
      setLoadErrorStatus(null);
      setTasks(d.tasks);
      if (epochAtFetchStart === presenceBootstrapEpoch.current) {
        setUserStatus(d.presence);
      }
      applyCoupleMeToStore({
        profile: { id: d.myProfileId, role: d.viewerRole },
        partnerProfileId: d.partnerProfileId ?? null,
        couple: d.coupleId ? { id: d.coupleId } : null,
      });
      return;
    }
    if (!opts?.silent) {
      const fallback =
        r.status === 401
          ? "请先登录"
          : r.status === 403
            ? "当前账号未加入情侣房间或无权访问"
            : "加载失败";
      setLoadError(getApiErrorField(d.error, fallback));
      setLoadErrorStatus(r.status);
    }
  }, []);

  useEffect(() => {
    void loadAchievements();
  }, [loadAchievements]);

  /** 双方设备无 Realtime 时，定时与回到前台刷新任务与状态岛、悄悄话 */
  useEffect(() => {
    const pollMs = 12_000;
    const id = window.setInterval(() => void loadAchievements({ silent: true }), pollMs);
    const onVis = () => {
      if (document.visibilityState === "visible") void loadAchievements({ silent: true });
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [loadAchievements]);

  const sortedTasks = useMemo(() => {
    if (!tasks) return [];
    return [...tasks].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }, [tasks]);

  const myTasks = useMemo(() => sortedTasks.filter((t) => t.owner === "me"), [sortedTasks]);
  const partnerTasks = useMemo(() => sortedTasks.filter((t) => t.owner === "partner"), [sortedTasks]);

  const handlePresenceSaved = useCallback((next: UserStatusPair) => {
    presenceBootstrapEpoch.current += 1;
    setUserStatus(next);
  }, []);

  const handleTaskCreated = useCallback((task: AchievementTask) => {
    setTasks((prev) => [task, ...(prev ?? []).filter((t) => t.id !== task.id)]);
  }, []);

  const patchTaskRemote = useCallback(async (id: string, patch: Partial<AchievementTask>) => {
    const { achievementAuthHeaders } = await import("@/lib/achievements/clientAuth");
    const res = await fetch("/api/achievements/tasks", {
      method: "PATCH",
      headers: { "Content-Type": "application/json", ...(await achievementAuthHeaders()) },
      body: JSON.stringify({ id, ...patch }),
    });
    const data = (await res.json()) as { ok?: boolean; task?: AchievementTask; error?: unknown };
    if (!res.ok || !data.ok || !data.task) throw new Error(getApiErrorField(data.error, "同步失败"));
    return data.task;
  }, []);

  const deleteTaskRemote = useCallback(async (id: string) => {
    const { achievementAuthHeaders } = await import("@/lib/achievements/clientAuth");
    const res = await fetch("/api/achievements/tasks", {
      method: "DELETE",
      headers: { "Content-Type": "application/json", ...(await achievementAuthHeaders()) },
      body: JSON.stringify({ id }),
    });
    const data = (await res.json()) as { ok?: boolean; error?: unknown };
    if (!res.ok || !data.ok) throw new Error(getApiErrorField(data.error, "删除失败"));
  }, []);

  const handleDeleteTask = useCallback(
    async (taskId: string) => {
      await deleteTaskRemote(taskId);
      setTasks((prev) => (prev ?? []).filter((t) => t.id !== taskId));
      setSheetTask((t) => (t?.id === taskId ? null : t));
      setFocusTask((t) => (t?.id === taskId ? null : t));
      setUnbox((u) => (u?.taskId === taskId ? null : u));
    },
    [deleteTaskRemote],
  );

  const onTaskBodyClick = useCallback((task: AchievementTask) => {
    // 任务归属者（assignee）拆自己的盲盒；挂礼物的人在「TA 的」列只能挂未挂时的奖励
    if (task.owner === "me") {
      if (task.blindBox.isAttached && !task.blindBox.isOpened && task.blindBox.voucher) {
        setUnbox({ voucher: task.blindBox.voucher, taskId: task.id, blindBox: task.blindBox });
        return;
      }
      setFocusTask(task);
      return;
    }
    if (!task.blindBox.isAttached) {
      setSheetTask(task);
      return;
    }
    // 已为对方挂上、待对方拆开：不给挂礼方再进拆盒或重复挂
  }, []);

  const onBlindBoxConfirm = useCallback(
    (taskId: string, voucher: VoucherType) => {
      setTasks((prev) => {
        if (!prev) return prev;
        const t = prev.find((x) => x.id === taskId);
        if (!t) return prev;
        const blindBox: BlindBoxState = {
          ...t.blindBox,
          isAttached: true,
          isOpened: false,
          voucher,
          voiceUrl: "placeholder:voice",
        };
        void patchTaskRemote(taskId, { blindBox })
          .then((saved) => {
            setTasks((p) => (p ?? []).map((x) => (x.id === taskId ? saved : x)));
          })
          .catch(() => {});
        return prev.map((x) => (x.id === taskId ? { ...x, blindBox } : x));
      });
    },
    [patchTaskRemote],
  );

  const onUnboxClose = useCallback(() => {
    if (unbox) {
      const { taskId, blindBox } = unbox;
      void (async () => {
        try {
          const saved = await patchTaskRemote(taskId, {
            blindBox: { ...blindBox, isOpened: true },
          });
          setTasks((prev) => (prev ?? []).map((x) => (x.id === taskId ? saved : x)));
        } catch {
          /* ignore */
        }
      })();
    }
    setUnbox(null);
  }, [unbox, patchTaskRemote]);

  const onStartFocus = useCallback(async () => {
    try {
      const { achievementAuthHeaders } = await import("@/lib/achievements/clientAuth");
      const r = await fetch("/api/achievements/presence", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await achievementAuthHeaders()) },
        body: JSON.stringify({
          role: "me",
          statusText: "专注中",
          isFocusing: true,
        }),
      });
      const d = (await r.json()) as { ok?: boolean; presence?: UserStatusPair; error?: unknown };
      if (d.ok && d.presence) {
        presenceBootstrapEpoch.current += 1;
        setUserStatus(d.presence);
        return;
      }
    } catch {
      /* fallback: 仅本地展示 */
    }
    presenceBootstrapEpoch.current += 1;
    setUserStatus((s) =>
      s
        ? {
            ...s,
            me: { ...s.me, isFocusing: true, statusText: "专注中" },
          }
        : s,
    );
  }, []);

  if (loadError) {
    return (
      <div className="min-h-screen bg-[#FFF9F5]">
        <TopNav />
        <main className="mx-auto flex w-full max-w-6xl flex-col px-4 pb-24 pt-4 sm:pt-6">
          <p className="text-sm text-destructive">{loadError}</p>
          <p className="mt-2 text-sm text-muted-foreground">
            {loadErrorStatus === 401 || loadErrorStatus === 403
              ? "成就与悄悄话已按情侣空间隔离，需登录并绑定房间后再查看。"
              : "若你已在房间内仍看到此提示，多半是接口临时错误，请刷新页面；也可打开开发者工具查看 /api/achievements/bootstrap 的返回内容。"}
          </p>
        </main>
      </div>
    );
  }

  if (!userStatus || !tasks) {
    return (
      <div className="min-h-screen bg-[#FFF9F5]">
        <TopNav />
        <main className="mx-auto flex w-full max-w-6xl flex-col px-4 pb-24 pt-4 sm:pt-6">
          <p className="text-sm text-muted-foreground">加载成就数据…</p>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#FFF9F5]">
      <TopNav />
      <main className="mx-auto flex w-full max-w-6xl flex-col px-4 pb-24 pt-4 sm:pt-6">
        <div className="mb-4 shrink-0">
          <div className="text-sm text-muted-foreground">Achievements</div>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight">成就与契约</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            记录已完成的点滴：选择分值后计入主页羁绊进度。
          </p>
        </div>

        <StatusIsland
          me={userStatus.me}
          partner={userStatus.partner}
          onAvatarClick={(role) => {
            // 未读悄悄话记在「我」的 profile 行，红点在自己头像上：应打开小纸条而非「我的状态」
            if (role === "me" && (userStatus.me.unreadWhispers ?? 0) > 0) {
              setPartnerViewerOpen(true);
              return;
            }
            if (role === "me") setMyStatusOpen(true);
            else setPartnerViewerOpen(true);
          }}
        />

        <div className="mt-6 grid min-h-0 flex-1 gap-6 md:grid-cols-2 md:gap-8">
          <section className="min-w-0 flex flex-col">
            <h2 className="mb-3 text-sm font-medium text-muted-foreground">我的成就</h2>
            <div className="glass-panel flex-1 rounded-3xl p-4 sm:p-5">
              {myTasks.length === 0 ? (
                <p className="py-8 text-center text-sm text-muted-foreground">还没有自己的任务，点下方 + 添加吧</p>
              ) : (
                <TaskBoard tasks={myTasks} onTaskBodyClick={onTaskBodyClick} onDeleteTask={handleDeleteTask} singleColumn />
              )}
            </div>
          </section>
          <section className="min-w-0 flex flex-col">
            <h2 className="mb-3 text-sm font-medium text-muted-foreground">TA 的小惊喜</h2>
            <div className="glass-panel flex-1 rounded-3xl p-4 sm:p-5">
              {partnerTasks.length === 0 ? (
                <p className="py-8 text-center text-sm text-muted-foreground">还没有对方任务；通关后可挂盲盒惊喜</p>
              ) : (
                <TaskBoard tasks={partnerTasks} onTaskBodyClick={onTaskBodyClick} onDeleteTask={handleDeleteTask} singleColumn />
              )}
            </div>
          </section>
        </div>
      </main>

      <FloatingActionButton onClick={() => setAddOpen(true)} hint="敲厉害的小狗来啦" />

      <AddAchievementModal open={addOpen} onClose={() => setAddOpen(false)} onCreated={handleTaskCreated} />

      <MyStatusEditor
        open={myStatusOpen}
        presence={userStatus}
        onClose={() => setMyStatusOpen(false)}
        onSaved={handlePresenceSaved}
      />

      <PartnerStatusViewer
        open={partnerViewerOpen}
        presence={userStatus}
        onClose={() => setPartnerViewerOpen(false)}
        onPresenceUpdate={handlePresenceSaved}
      />

      <AddBlindBoxSheet
        key={sheetTask ? `${sheetTask.id}-open` : "sheet-closed"}
        open={!!sheetTask}
        task={sheetTask}
        onClose={() => setSheetTask(null)}
        onConfirm={onBlindBoxConfirm}
      />

      <FocusModeModal
        open={!!focusTask}
        task={focusTask}
        onClose={() => setFocusTask(null)}
        onStartFocus={onStartFocus}
      />

      <UnboxModal open={!!unbox} voucher={unbox?.voucher ?? null} onClose={onUnboxClose} />
    </div>
  );
}
