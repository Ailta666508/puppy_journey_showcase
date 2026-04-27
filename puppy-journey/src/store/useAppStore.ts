import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { getApiErrorField } from "@/lib/getErrorMessage";
import { normalizePhotoUrls } from "@/lib/normalizePhotoUrls";
import { supabaseBearerHeaders } from "@/lib/supabase/apiSessionHeaders";
import type { UserRole } from "@/lib/userRole";

export type AchievementType = "milestone" | "contract";
export type AchievementTerm = "short" | "long" | "system";
export type AchievementStatus = "active" | "completed";

export interface Achievement {
  id: string;
  title: string;
  type: AchievementType;
  term: AchievementTerm;
  points: number;
  status: AchievementStatus;
  completedAt?: string;
}

export interface TravelLog {
  id: string;
  title: string;
  date: string;
  locationText?: string;
  note?: string;
  photoUrls: string[];
  createdAt: string;
  /** 服务端由 author_id + 情侣槽位解析 */
  authorRole?: UserRole | null;
  /** 是否当前登录用户所写（用于删除按钮等） */
  mine?: boolean;
}

/** 新建心愿时选择：对应主页「下一次见面」/「结束分离状态」进度语境 */
export type WishBondCategory = "next_meeting" | "end_separation";

export interface WishItem {
  id: string;
  wishDate: string;
  place: string;
  thing: string;
  createdAt: string;
  isCompleted: boolean;
  wishCategory: WishBondCategory;
  authorRole?: UserRole | null;
  mine?: boolean;
}

export interface AppState {
  /** 当前视角：与 profiles.role 一致（小鸡毛=yellow_dog，小白=white_dog），由情侣空间与 /api/couple/me 同步 */
  currentUserRole: UserRole;
  setCurrentUserRole: (role: UserRole) => void;

  /** 当前登录用户的 profiles.id */
  myProfileId: string | null;
  /** 伴侣 profiles.id（来自 couples 槽位推导，供客户端展示与调试） */
  partnerProfileId: string | null;
  coupleId: string | null;
  setCoupleIdentity: (p: {
    myProfileId: string | null;
    partnerProfileId: string | null;
    coupleId: string | null;
  }) => void;

  achievementPoints: number;
  achievements: Achievement[];
  travelLogs: TravelLog[];
  wishes: WishItem[];

  bondTargetNextMeeting: number;
  bondTargetEndSeparation: number;

  setAchievementPoints: (points: number) => void;
  addAchievementPoints: (delta: number) => void;

  fetchTravelLogs: () => Promise<void>;
  addTravelLog: (log: Omit<TravelLog, "id" | "createdAt">) => Promise<void>;
  removeTravelLog: (id: string) => Promise<void>;

  fetchWishes: () => Promise<WishItem[]>;
  addWish: (item: Omit<WishItem, "id" | "createdAt" | "isCompleted">) => Promise<void>;
  completeWish: (wishId: string) => Promise<void>;
  removeWish: (wishId: string) => Promise<void>;

  loadBondSettings: () => Promise<void>;
  saveBondSettings: (nextMeeting: number, endSeparation: number) => Promise<void>;

  /** 退出情侣空间等场景：清空本地旅行/心愿列表（服务端已按 couple 隔离） */
  clearTravelAndWishes: () => void;
}

export const useAppStore = create<AppState>()(
  persist(
    (set, get) => ({
      currentUserRole: "white_dog",
      setCurrentUserRole: (role) => set({ currentUserRole: role }),

      myProfileId: null,
      partnerProfileId: null,
      coupleId: null,
      setCoupleIdentity: (p) =>
        set({
          myProfileId: p.myProfileId,
          partnerProfileId: p.partnerProfileId,
          coupleId: p.coupleId,
        }),

      achievementPoints: 0,
      achievements: [],
      travelLogs: [],
      wishes: [],

      bondTargetNextMeeting: 100,
      bondTargetEndSeparation: 100,

      setAchievementPoints: (points) => set({ achievementPoints: Math.max(0, Math.floor(points)) }),
      addAchievementPoints: (delta) =>
        set((s) => ({
          achievementPoints: Math.max(0, Math.floor(s.achievementPoints + delta)),
        })),

      fetchTravelLogs: async () => {
        try {
          const headers = await supabaseBearerHeaders();
          const res = await fetch("/api/travel-logs", {
            cache: "no-store",
            headers: { ...headers },
          });
          let data: { ok?: boolean; travelLogs?: TravelLog[] };
          try {
            data = (await res.json()) as typeof data;
          } catch {
            return;
          }
          if (res.ok && data.ok && Array.isArray(data.travelLogs)) {
            set((s) => {
              const prevById = new Map(s.travelLogs.map((l) => [l.id, l]));
              const travelLogs = data.travelLogs!.map((log) => {
                const fromServer = normalizePhotoUrls(log.photoUrls as unknown);
                const prev = prevById.get(log.id);
                const fromPrev = prev ? normalizePhotoUrls(prev.photoUrls as unknown) : [];
                if (fromServer.length > 0) return { ...log, photoUrls: fromServer };
                if (fromPrev.length > 0) return { ...log, photoUrls: fromPrev };
                return { ...log, photoUrls: fromServer };
              });
              return { travelLogs };
            });
          }
        } catch {
          /* 网络或 JSON 异常时不打断整页渲染 */
        }
      },

      addTravelLog: async (log) => {
        const headers = await supabaseBearerHeaders();
        const raw = log.photoUrls ?? [];
        const photoUrls = raw.filter((u): u is string => typeof u === "string" && u.trim().length > 0);
        if (raw.length > 0 && photoUrls.length === 0) {
          throw new Error("图片数据为空字符串，请重新选择照片后再保存");
        }
        const body: Record<string, unknown> = {
          title: log.title,
          date: log.date,
          locationText: log.locationText,
          note: log.note,
          photoUrls,
          photo_urls: photoUrls,
        };
        const res = await fetch("/api/travel-logs", {
          method: "POST",
          headers: { "Content-Type": "application/json", ...headers },
          body: JSON.stringify(body),
        });
        const data = (await res.json()) as { ok?: boolean; travelLog?: TravelLog; error?: string };
        if (!res.ok || !data.ok || !data.travelLog) {
          throw new Error(getApiErrorField(data.error, "保存旅行日志失败"));
        }
        const tl = data.travelLog!;
        const fromServer = normalizePhotoUrls(tl.photoUrls as unknown);
        // 读回 photo_urls 偶尔为空时，仍用本次请求里已拿到的公开 URL 填充时间线（上传已成功则链接有效）
        const mergedPhotos =
          fromServer.length > 0 ? fromServer : photoUrls.length > 0 ? photoUrls : fromServer;
        set((s) => ({
          travelLogs: [{ ...tl, photoUrls: mergedPhotos }, ...s.travelLogs],
        }));
      },

      removeTravelLog: async (id) => {
        const headers = await supabaseBearerHeaders();
        const res = await fetch(`/api/travel-logs/${encodeURIComponent(id)}`, {
          method: "DELETE",
          headers: { "Content-Type": "application/json", ...headers },
          body: JSON.stringify({}),
        });
        const data = (await res.json()) as { ok?: boolean; error?: string };
        if (!res.ok || !data.ok) throw new Error(data.error || "删除失败");
        set((s) => ({ travelLogs: s.travelLogs.filter((x) => x.id !== id) }));
      },

      fetchWishes: async () => {
        try {
          const headers = await supabaseBearerHeaders();
          const res = await fetch("/api/wishes", { cache: "no-store", headers: { ...headers } });
          const data = (await res.json()) as { ok?: boolean; wishes?: WishItem[] };
          if (res.ok && data.ok && Array.isArray(data.wishes)) {
            set({ wishes: data.wishes });
            return data.wishes;
          }
        } catch {
          /* 网络或非 JSON 响应时不打断整页 */
        }
        return get().wishes;
      },

      addWish: async (item) => {
        const headers = await supabaseBearerHeaders();
        const cat: WishBondCategory =
          item.wishCategory === "end_separation" ? "end_separation" : "next_meeting";
        const res = await fetch("/api/wishes", {
          method: "POST",
          headers: { "Content-Type": "application/json", ...headers },
          body: JSON.stringify({
            wishDate: item.wishDate,
            place: item.place?.trim() || "",
            thing: item.thing?.trim() || "",
            wishCategory: cat,
          }),
        });
        const data = (await res.json()) as { ok?: boolean; wish?: WishItem; error?: string };
        if (!res.ok || !data.ok || !data.wish) throw new Error(data.error || "保存心愿失败");
        set((s) => ({ wishes: [data.wish!, ...s.wishes] }));
      },

      completeWish: async (wishId: string) => {
        const headers = await supabaseBearerHeaders();
        const res = await fetch(`/api/wishes/${encodeURIComponent(wishId)}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json", ...headers },
          body: JSON.stringify({ isCompleted: true }),
        });
        const data = (await res.json()) as { ok?: boolean; error?: string };
        if (!res.ok || !data.ok) throw new Error(data.error || "更新失败");
        set((s) => ({
          wishes: s.wishes.map((w) => (w.id === wishId ? { ...w, isCompleted: true } : w)),
        }));
      },

      removeWish: async (wishId: string) => {
        const headers = await supabaseBearerHeaders();
        const res = await fetch(`/api/wishes/${encodeURIComponent(wishId)}`, {
          method: "DELETE",
          headers: { "Content-Type": "application/json", ...headers },
          body: JSON.stringify({}),
        });
        const data = (await res.json()) as { ok?: boolean; error?: string };
        if (!res.ok || !data.ok) throw new Error(data.error || "删除失败");
        set((s) => ({ wishes: s.wishes.filter((w) => w.id !== wishId) }));
      },

      loadBondSettings: async () => {
        try {
          const headers = await supabaseBearerHeaders();
          const res = await fetch("/api/bond-settings", {
            cache: "no-store",
            headers: { ...headers },
          });
          const data = (await res.json()) as {
            ok?: boolean;
            bondTargetNextMeeting?: number;
            bondTargetEndSeparation?: number;
          };
          if (res.ok && data.ok) {
            set({
              bondTargetNextMeeting: Math.max(1, Math.floor(data.bondTargetNextMeeting ?? 100)),
              bondTargetEndSeparation: Math.max(1, Math.floor(data.bondTargetEndSeparation ?? 100)),
            });
          }
        } catch {
          /* 网络或非 JSON 响应时不打断整页 */
        }
      },

      clearTravelAndWishes: () => set({ travelLogs: [], wishes: [] }),

      saveBondSettings: async (nextMeeting: number, endSeparation: number) => {
        const headers = await supabaseBearerHeaders();
        const nm = Math.max(1, Math.min(999_999, Math.floor(Number(nextMeeting) || 1)));
        const es = Math.max(1, Math.min(999_999, Math.floor(Number(endSeparation) || 1)));
        const res = await fetch("/api/bond-settings", {
          method: "PUT",
          headers: { "Content-Type": "application/json", ...headers },
          body: JSON.stringify({
            bondTargetNextMeeting: nm,
            bondTargetEndSeparation: es,
          }),
        });
        const data = (await res.json()) as { ok?: boolean; error?: string };
        if (!res.ok || !data.ok) throw new Error(data.error || "保存失败");
        set({
          bondTargetNextMeeting: nm,
          bondTargetEndSeparation: es,
        });
      },
    }),
    {
      name: "pj-app-storage",
      version: 5,
      storage: createJSONStorage(() => {
        if (typeof window === "undefined") {
          return {
            getItem: () => null,
            setItem: () => {},
            removeItem: () => {},
          };
        }
        return {
          getItem: (name) => {
            try {
              const raw = window.localStorage.getItem(name);
              if (raw == null) return null;
              JSON.parse(raw);
              return raw;
            } catch {
              try {
                window.localStorage.removeItem(name);
              } catch {
                /* ignore */
              }
              return null;
            }
          },
          setItem: (name, value) => {
            try {
              window.localStorage.setItem(name, value);
            } catch {
              /* quota 等 */
            }
          },
          removeItem: (name) => {
            try {
              window.localStorage.removeItem(name);
            } catch {
              /* ignore */
            }
          },
        };
      }),
      migrate: (persisted, fromVersion) => {
        const base =
          persisted && typeof persisted === "object"
            ? { ...(persisted as Record<string, unknown>) }
            : {};
        if (fromVersion < 3) {
          delete base.wishes;
          delete base.bondTargetNextMeeting;
          delete base.bondTargetEndSeparation;
        }
        if (fromVersion < 4) {
          delete base.currentUserRole;
        }
        return base;
      },
      /** 视角以服务端 profiles.role 为准，不再写入 localStorage，避免与情侣空间选角冲突 */
      partialize: () => ({}),
    },
  ),
);
