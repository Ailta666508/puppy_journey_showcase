import type { AchievementTask, TaskOwner, UserPresence, UserStatusPair } from "@/components/achievements/types";
import { roleForProfileInCouple } from "@/lib/couple/authorRole";
import {
  normalizeAchievementScore,
  normalizeAchievementTitle,
  normalizeBlindBoxFromDb,
} from "@/lib/db/achievementRowNormalize";
import { coerceDbTextField } from "@/lib/db/coerceDbText";

function coerceDbBool(v: unknown): boolean {
  if (v === true) return true;
  if (v === false || v == null) return false;
  if (typeof v === "number" && v !== 0) return true;
  if (typeof v === "string") {
    const s = v.trim().toLowerCase();
    return s === "true" || s === "t" || s === "1";
  }
  return false;
}
import { isUserRole, isUuid, partnerRole, ROLE_INFO, type UserRole } from "@/lib/userRole";

/** 解析「谁创建了这条成就」：以 author_id 为准；仅迁移前旧行可能仍仅有 user_id（UUID 字符串） */
export function taskCreatorProfileIdFromRow(row: {
  author_id?: string | null;
  user_id?: string | null;
}): string {
  const a = row.author_id != null ? String(row.author_id).trim() : "";
  if (a && isUuid(a)) return a;
  const u = row.user_id != null ? String(row.user_id).trim() : "";
  if (u === "yellow_dog" || u === "white_dog") return "";
  if (u && isUuid(u)) return u;
  return "";
}

export function taskRowToAchievementTask(
  row: {
    id: string;
    assignee_id?: string | null;
    author_id?: string | null;
    user_id?: string | null;
    title: unknown;
    score: unknown;
    blind_box: unknown;
    created_at: string;
    author_profile?: { role?: string | null } | null;
    assignee_profile?: { role?: string | null } | null;
  },
  myProfileId: string,
  partnerProfileId: string | null,
  coupleYellowDogId: string | null,
  coupleWhiteDogId: string | null,
  myRole: UserRole,
): AchievementTask {
  const assigneeRaw = row.assignee_id != null ? String(row.assignee_id).trim() : "";
  const authorRaw = taskCreatorProfileIdFromRow(row);

  let owner: TaskOwner = "partner";

  if (assigneeRaw && isUuid(assigneeRaw)) {
    if (assigneeRaw === myProfileId) owner = "me";
    else if (partnerProfileId && assigneeRaw === partnerProfileId) owner = "partner";
    else {
      const slot = roleForProfileInCouple(assigneeRaw, coupleYellowDogId, coupleWhiteDogId);
      if (slot === myRole) owner = "me";
      else if (slot) owner = "partner";
    }
  } else if (assigneeRaw === "yellow_dog" || assigneeRaw === "white_dog") {
    owner = assigneeRaw === myRole ? "me" : "partner";
  } else if (authorRaw && isUuid(authorRaw)) {
    if (authorRaw === myProfileId) owner = "me";
    else if (partnerProfileId && authorRaw === partnerProfileId) owner = "partner";
    else {
      const slot = roleForProfileInCouple(authorRaw, coupleYellowDogId, coupleWhiteDogId);
      if (slot === myRole) owner = "me";
      else if (slot) owner = "partner";
    }
  } else {
    const u = row.user_id != null ? String(row.user_id).trim() : "";
    const auth = row.author_id != null ? String(row.author_id).trim() : "";
    const slotOnly =
      u === "yellow_dog" || u === "white_dog"
        ? u
        : auth === "yellow_dog" || auth === "white_dog"
          ? auth
          : null;
    if (slotOnly === "yellow_dog" || slotOnly === "white_dog") {
      owner = slotOnly === myRole ? "me" : "partner";
    } else {
      const ar = row.assignee_profile?.role;
      const br = row.author_profile?.role;
      if (isUserRole(ar)) owner = ar === myRole ? "me" : "partner";
      else if (isUserRole(br)) owner = br === myRole ? "me" : "partner";
    }
  }

  const blindBox = normalizeBlindBoxFromDb(row.blind_box);
  return {
    id: row.id,
    owner,
    title: normalizeAchievementTitle(row.title) || "（无标题）",
    score: normalizeAchievementScore(row.score),
    blindBox,
    createdAt: row.created_at,
  };
}

export function presenceRowToUserPresence(row: {
  status_text: unknown;
  avatar: unknown;
  status_icon: string | null;
  unread_whispers: number | null;
  last_whisper_received: unknown;
  is_focusing?: boolean | null;
}, slotRole: UserRole): UserPresence {
  const statusText = coerceDbTextField(row.status_text);
  const avatarRaw = coerceDbTextField(row.avatar);
  const whisperRaw = coerceDbTextField(row.last_whisper_received);
  const lastWhisper = whisperRaw.trim() ? whisperRaw : null;
  const ri = ROLE_INFO[slotRole];
  return {
    isFocusing: coerceDbBool(row.is_focusing),
    statusText,
    avatar: avatarRaw.trim() || ri.emoji,
    roleAvatarUrl: ri.avatarSrc,
    statusIcon: (row.status_icon as UserPresence["statusIcon"]) ?? null,
    unreadWhispers: row.unread_whispers ?? 0,
    lastWhisperReceived: lastWhisper,
  };
}

export type PresenceRow = {
  profile_id?: string | null;
  couple_id?: string | null;
  status_text: string | null;
  avatar: string | null;
  status_icon: string | null;
  unread_whispers: number | null;
  last_whisper_received: string | null;
  is_focusing?: boolean | null;
  updated_at?: string | null;
};

function presenceRowUpdatedAtMs(row: PresenceRow): number {
  const raw = row.updated_at;
  if (raw == null || String(raw).trim() === "") return 0;
  const t = Date.parse(String(raw));
  return Number.isFinite(t) ? t : 0;
}

/** 同一 profile 若有多行（异常数据），取 updated_at 最新的一条，避免专注等字段读到旧行 */
function pickPresenceRowForProfile(rows: PresenceRow[], profileId: string): PresenceRow | undefined {
  const pid = profileId.trim();
  const matches = rows.filter((r) => String(r.profile_id ?? "").trim() === pid);
  if (matches.length === 0) return undefined;
  if (matches.length === 1) return matches[0];
  return matches.reduce((best, r) => (presenceRowUpdatedAtMs(r) > presenceRowUpdatedAtMs(best) ? r : best));
}

function emptyPresence(role: UserRole): UserPresence {
  const ri = ROLE_INFO[role];
  return {
    isFocusing: false,
    statusText: "",
    avatar: ri.emoji,
    roleAvatarUrl: ri.avatarSrc,
    statusIcon: null,
    unreadWhispers: 0,
    lastWhisperReceived: null,
  };
}

export function buildUserStatusPair(
  rows: PresenceRow[],
  myProfileId: string,
  partnerProfileId: string | null,
  coupleYellowDogId: string | null,
  coupleWhiteDogId: string | null,
): UserStatusPair {
  const sorted = [...rows].sort((a, b) => {
    const ap = a.profile_id != null && String(a.profile_id).trim() !== "" ? 1 : 0;
    const bp = b.profile_id != null && String(b.profile_id).trim() !== "" ? 1 : 0;
    return bp - ap;
  });
  const meRow = pickPresenceRowForProfile(sorted, myProfileId);
  const partnerRow =
    partnerProfileId != null ? pickPresenceRowForProfile(sorted, partnerProfileId) : undefined;

  const meRole =
    roleForProfileInCouple(myProfileId, coupleYellowDogId, coupleWhiteDogId) ?? ("white_dog" as UserRole);
  const partnerResolved = partnerProfileId
    ? roleForProfileInCouple(partnerProfileId, coupleYellowDogId, coupleWhiteDogId)
    : null;
  const partnerRoleResolved = partnerResolved ?? partnerRole(meRole);

  return {
    me: meRow ? presenceRowToUserPresence(meRow, meRole) : emptyPresence(meRole),
    partner: partnerRow
      ? presenceRowToUserPresence(partnerRow, partnerRoleResolved)
      : emptyPresence(partnerRoleResolved),
  };
}
