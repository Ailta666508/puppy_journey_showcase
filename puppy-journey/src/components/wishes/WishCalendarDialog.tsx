"use client";

import { zhCN } from "date-fns/locale";
import { useState } from "react";
import { DayPicker } from "react-day-picker";
import { Calendar as CalendarIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { formatWishCardHeader, parseWishDate, toYyyyMmDd } from "@/lib/wishDateFormat";

import "react-day-picker/style.css";

type Props = {
  value: string;
  onChange: (yyyyMmDd: string) => void;
  className?: string;
};

/** 弹层日历选日（react-day-picker + zhCN），展示不含周几 */
export function WishCalendarDialog({ value, onChange, className }: Props) {
  const [open, setOpen] = useState(false);
  const selected = parseWishDate(value) ?? new Date();
  const [month, setMonth] = useState(selected);

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="lg"
        className={cn(
          "h-10 w-full justify-start gap-2 border-white/60 bg-white/80 text-left font-normal shadow-sm",
          className,
        )}
        onClick={() => setOpen(true)}
      >
        <CalendarIcon className="h-4 w-4 shrink-0 opacity-70" />
        <span className="truncate">{formatWishCardHeader(value)}</span>
      </Button>

      <Dialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (next) setMonth(parseWishDate(value) ?? new Date());
        }}
      >
        <DialogContent className="max-w-[min(100vw-2rem,340px)] sm:max-w-sm" showCloseButton>
          <DialogHeader>
            <DialogTitle>选择日期</DialogTitle>
          </DialogHeader>
          <div
            className={cn(
              "rdp-root rounded-xl border border-pink-100/80 bg-card/95 p-2 shadow-inner",
              "[--rdp-accent-color:theme(colors.pink.500)] [--rdp-accent-background-color:theme(colors.pink.50)]",
            )}
          >
            <DayPicker
              mode="single"
              required
              locale={zhCN}
              selected={selected}
              month={month}
              onMonthChange={setMonth}
              onSelect={(d) => {
                if (!d) return;
                onChange(toYyyyMmDd(d));
                setOpen(false);
              }}
              className="mx-auto w-fit"
            />
          </div>
          <p className="text-center text-xs text-muted-foreground">列表与卡片仅显示年月日，不含星期</p>
        </DialogContent>
      </Dialog>
    </>
  );
}
