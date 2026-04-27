import { NextResponse } from "next/server";

import { roleForProfileInCouple } from "@/lib/couple/authorRole";
import { requireCoupleWorkspaceContext } from "@/lib/couple/coupleWorkspaceContext";
import type { WishBondCategory, WishItem } from "@/store/useAppStore";

function rowToWish(
  row: {
    id: string;
    wish_date: string;
    place: string;
    thing: string;
    wish_category: string;
    is_completed: boolean;
    created_at: string;
    author_id?: string | null;
  },
  viewerId: string,
  coupleYellowDogId: string | null,
  coupleWhiteDogId: string | null,
): WishItem {
  const authorRole = roleForProfileInCouple(row.author_id ?? null, coupleYellowDogId, coupleWhiteDogId);
  const mine = row.author_id != null && row.author_id === viewerId;
  return {
    id: row.id,
    wishDate: row.wish_date,
    place: row.place,
    thing: row.thing,
    wishCategory: row.wish_category as WishBondCategory,
    isCompleted: row.is_completed,
    createdAt: row.created_at,
    authorRole: authorRole ?? undefined,
    mine,
  };
}

export async function GET(req: Request) {
  try {
    const gate = await requireCoupleWorkspaceContext(req);
    if (!gate.ok) return gate.response;
    const { supabase, coupleId, userId, role, coupleYellowDogId, coupleWhiteDogId } = gate.ctx;

    const { data: rows, error } = await supabase
      .from("wish_items")
      .select("*")
      .eq("couple_id", coupleId)
      .order("wish_date", { ascending: false });
    if (error) throw error;
    const wishes = (rows ?? []).map((r) =>
      rowToWish(r as Parameters<typeof rowToWish>[0], userId, coupleYellowDogId, coupleWhiteDogId),
    );
    return NextResponse.json({ ok: true, wishes, viewer_role: role });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const gate = await requireCoupleWorkspaceContext(req);
    if (!gate.ok) return gate.response;
    const ctx = gate.ctx;

    const body = (await req.json()) as {
      wishDate?: string;
      place?: string;
      thing?: string;
      wishCategory?: WishBondCategory;
    };
    const wishDate = body.wishDate?.trim();
    if (!wishDate) {
      return NextResponse.json({ ok: false, error: "缺少 wishDate" }, { status: 400 });
    }
    const cat: WishBondCategory =
      body.wishCategory === "end_separation" ? "end_separation" : "next_meeting";
    const { supabase, coupleId, userId, coupleYellowDogId, coupleWhiteDogId } = ctx;
    const { data: row, error } = await supabase
      .from("wish_items")
      .insert({
        couple_id: coupleId,
        author_id: userId,
        wish_date: wishDate,
        place: body.place?.trim() || "",
        thing: body.thing?.trim() || "",
        wish_category: cat,
        is_completed: false,
      })
      .select("*")
      .single();
    if (error) throw error;
    return NextResponse.json({
      ok: true,
      wish: rowToWish(row as Parameters<typeof rowToWish>[0], userId, coupleYellowDogId, coupleWhiteDogId),
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}
