import { isUserRole } from "@/lib/userRole";
import { useAppStore } from "@/store/useAppStore";

export type CoupleMePayload = {
  profile?: { id?: string; role?: string | null } | null;
  partnerProfileId?: string | null;
  couple?: { id?: string } | null;
};

/**
 * 将 Supabase profiles.role（yellow_dog | white_dog）同步到全局「当前视角」，
 * 旅行/心愿列表按 couple_id 拉全房间数据；mutate 仍按 author_id 校验。此处同步 profiles.role 供当前视角 UI。
 */
export function applyProfileRoleToStore(role: unknown): void {
  const s = useAppStore.getState();
  if (!isUserRole(role)) {
    if (role === null || role === undefined || role === "") {
      s.setCurrentUserRole("white_dog");
      s.clearTravelAndWishes();
      s.setCoupleIdentity({ myProfileId: null, partnerProfileId: null, coupleId: null });
    }
    return;
  }
  if (s.currentUserRole === role) return;
  s.setCurrentUserRole(role);
  const swallow = () => {};
  void s.fetchTravelLogs().catch(swallow);
  void s.fetchWishes().catch(swallow);
  void s.loadBondSettings().catch(swallow);
}

/** /api/couple/me 或成就 bootstrap：写入 partnerProfileId（法则一） */
export function applyCoupleMeToStore(payload: CoupleMePayload): void {
  applyProfileRoleToStore(payload.profile?.role);
  useAppStore.getState().setCoupleIdentity({
    myProfileId: payload.profile?.id ?? null,
    partnerProfileId: payload.partnerProfileId ?? null,
    coupleId: payload.couple?.id ?? null,
  });
}
