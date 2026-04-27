import type { UserRole } from "@/lib/userRole";

/** 将 author 的 profile UUID 映射为情侣房间内的黄狗/白狗角色（用于 UI：ROLE_INFO 等） */
export function roleForProfileInCouple(
  authorId: string | null | undefined,
  coupleYellowDogId: string | null,
  coupleWhiteDogId: string | null,
): UserRole | null {
  if (authorId == null || String(authorId).trim() === "") return null;
  if (authorId === coupleYellowDogId) return "yellow_dog";
  if (authorId === coupleWhiteDogId) return "white_dog";
  return null;
}
