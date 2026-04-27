import type { WishItem } from "@/store/useAppStore";
import { toYyyyMmDd } from "@/lib/wishDateFormat";

const d = (daysAgo: number) => toYyyyMmDd(new Date(Date.now() - 86400_000 * daysAgo));

/** 无数据时展示的示例心愿（不可标记已实现） */
export const DEMO_WISHES: WishItem[] = [
  {
    id: "demo_meeting",
    wishDate: d(0),
    place: "市中心小巷里的「蓬松兔」甜品店",
    thing: "点两份舒芙蕾，互相喂一口",
    createdAt: new Date(Date.now() - 3600_000 * 2).toISOString(),
    isCompleted: false,
    wishCategory: "next_meeting",
  },
  {
    id: "demo_study",
    wishDate: d(2),
    place: "家里沙发 + 小台灯",
    thing: "番茄钟 3 轮，结束奖励奶茶",
    createdAt: new Date(Date.now() - 86400_000 * 2).toISOString(),
    isCompleted: false,
    wishCategory: "next_meeting",
  },
  {
    id: "demo_travel",
    wishDate: d(9),
    place: "周边 2 小时车程的观景台",
    thing: "裹着毯子喝热可可，拍一张剪影",
    createdAt: new Date(Date.now() - 86400_000 * 9).toISOString(),
    isCompleted: false,
    wishCategory: "end_separation",
  },
];
