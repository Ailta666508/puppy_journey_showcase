"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useAppStore, type WishBondCategory } from "@/store/useAppStore";
import { cn } from "@/lib/utils";
import { WISH_MACARON_BG, WISH_MACARON_BORDER } from "@/lib/wishCardStyle";
import { toYyyyMmDd } from "@/lib/wishDateFormat";
import { WishCalendarDialog } from "./WishCalendarDialog";
import { WishDatePill } from "./WishDatePill";

const cardBg = WISH_MACARON_BG[0]!;
const cardBorder = WISH_MACARON_BORDER[0]!;

/**
 * 左日期胶囊 + 右大卡；新建时选择「下一次见面 / 结束分离状态」
 */
export function WishNewTimelineForm() {
  const router = useRouter();
  const addWish = useAppStore((s) => s.addWish);
  const [saving, setSaving] = useState(false);

  const [wishDate, setWishDate] = useState(() => toYyyyMmDd(new Date()));
  const [place, setPlace] = useState("");
  const [thing, setThing] = useState("");
  const [wishCategory, setWishCategory] = useState<WishBondCategory>("next_meeting");

  async function submit() {
    if (saving) return;
    setSaving(true);
    try {
      await addWish({
        wishDate,
        place: place.trim() || "待定",
        thing: thing.trim() || "待定",
        wishCategory,
      });
      router.push("/wishes");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex gap-3 sm:gap-4">
      <WishDatePill wishDate={wishDate} colorSeed={wishDate} />

      <div className="min-w-0 flex-1">
        <div
          className={cn(
            "rounded-2xl border p-4 shadow-sm sm:p-5",
            cardBorder,
            cardBg,
          )}
        >
          <div className="space-y-2">
            <Label className="text-xs font-medium text-foreground/80">日期</Label>
            <WishCalendarDialog value={wishDate} onChange={setWishDate} />
          </div>

          <div className="mt-4 grid gap-2">
            <span className="text-sm font-medium">这条心愿更贴近</span>
            <div className="flex flex-wrap gap-2">
              <CategoryCapsule
                active={wishCategory === "next_meeting"}
                onClick={() => setWishCategory("next_meeting")}
                label="下一次见面"
              />
              <CategoryCapsule
                active={wishCategory === "end_separation"}
                onClick={() => setWishCategory("end_separation")}
                label="结束分离状态"
              />
            </div>
          </div>

          <div className="mt-4 space-y-3">
            <Field label="想去的地方" id="w-place">
              <Input
                id="w-place"
                value={place}
                onChange={(e) => setPlace(e.target.value)}
                placeholder="城市、小店或一片海"
                className="border-white/60 bg-white/70"
              />
            </Field>
            <Field label="旅行随笔" id="w-thing">
              <Textarea
                id="w-thing"
                value={thing}
                onChange={(e) => setThing(e.target.value)}
                placeholder="与旅行日志「旅行随笔」一致：记录想一起完成的小事、画面或心情～"
                className="min-h-[88px] border-white/60 bg-white/70"
              />
            </Field>
          </div>

          <p className="mt-3 flex items-start gap-2 text-xs text-muted-foreground">
            <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-white shadow-sm ring-1 ring-black/5" />
            分类用于心愿墙筛选；主页进度条得分仅来自成就页累加分与您设置的目标总分。
          </p>

          <div className="mt-5 flex flex-wrap gap-2">
            <Button
              type="button"
              className="pj-btn-gradient text-white"
              disabled={saving}
              onClick={() => void submit()}
            >
              {saving ? "保存中…" : "保存心愿"}
            </Button>
            <Button type="button" variant="secondary" onClick={() => router.push("/wishes")}>
              取消
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function CategoryCapsule(props: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={props.onClick}
      className={cn(
        "rounded-full border px-3 py-1.5 text-xs font-medium transition-colors sm:text-[13px]",
        props.active
          ? "border-primary bg-primary/15 text-primary shadow-sm"
          : "border-white/70 bg-white/50 text-stone-600 hover:bg-white/70",
      )}
    >
      {props.label}
    </button>
  );
}

function Field({ id, label, children }: { id: string; label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id} className="text-xs font-medium text-foreground/80">
        {label}
      </Label>
      {children}
    </div>
  );
}
