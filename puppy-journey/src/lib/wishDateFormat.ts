import { format, isValid, parse } from "date-fns";
import { zhCN } from "date-fns/locale";

/** 存储格式 yyyy-MM-dd */
export function toYyyyMmDd(d: Date): string {
  return format(d, "yyyy-MM-dd");
}

export function parseWishDate(s: string): Date | null {
  const d = parse(s, "yyyy-MM-dd", new Date());
  return isValid(d) ? d : null;
}

/** 卡片顶栏：仅年月日，不含周几 */
export function formatWishCardHeader(wishDate: string): string {
  const d = parseWishDate(wishDate);
  if (!d) return "日期待定";
  return format(d, "yyyy年M月d日", { locale: zhCN });
}

/** 时间轴左侧胶囊：yyyy.M.d（无前导零） */
export function formatWishPillCompact(wishDate: string): string {
  const d = parseWishDate(wishDate);
  if (!d) return "—";
  return `${d.getFullYear()}.${d.getMonth() + 1}.${d.getDate()}`;
}
