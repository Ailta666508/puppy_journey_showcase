import { NextResponse } from "next/server";

import { roleForProfileInCouple } from "@/lib/couple/authorRole";
import { requireCoupleWorkspaceContext } from "@/lib/couple/coupleWorkspaceContext";
import { getErrorMessage } from "@/lib/getErrorMessage";
import { coercePhotoUrlItem, normalizePhotoUrls } from "@/lib/normalizePhotoUrls";
import { resolveTravelLogPhotoUrlsForPersistence } from "@/lib/travelUserUploadsStorage";
import type { TravelLog } from "@/store/useAppStore";

export const runtime = "nodejs";

type TravelLogRow = {
  id: string;
  title: string;
  travel_date: string;
  location_text: string | null;
  note: string | null;
  photo_urls: unknown;
  created_at: string;
  couple_id?: string | null;
  author_id?: string | null;
};

function resolveLogPhotos(row: TravelLogRow): string[] {
  return normalizePhotoUrls(row.photo_urls);
}

/** 接受 Data URL（可再上传）、已是 Storage 的 https/sb:（仅入库）；数组走直通校验，避免 normalize 静默丢项 */
function photoInputsForPersistence(input: unknown): string[] {
  if (input == null) return [];

  const out: string[] = [];
  const stripBom = (s: string) => s.replace(/^\uFEFF/, "").trim();

  const pushValid = (raw: string) => {
    const v = stripBom(raw);
    if (!v) return;
    const isData = v.startsWith("data:") && /;base64,/i.test(v);
    const isHttp = v.startsWith("http://") || v.startsWith("https://");
    const isSb = v.startsWith("sb:");
    if (!isData && !isHttp && !isSb) {
      throw new Error(`无效的图片项（需 data:/https/sb:）: ${v.slice(0, 80)}`);
    }
    out.push(v);
  };

  if (Array.isArray(input)) {
    for (const el of input) {
      if (typeof el === "string") pushValid(el);
      else {
        const u = coercePhotoUrlItem(el);
        if (u) pushValid(u);
      }
    }
    return out;
  }

  if (typeof input === "string") {
    const t = stripBom(input);
    if (!t) return [];
    try {
      return photoInputsForPersistence(JSON.parse(t) as unknown);
    } catch {
      pushValid(t);
      return out;
    }
  }

  if (typeof input === "object") {
    const o = input as Record<string, unknown>;
    const nested = o.photoUrls ?? o.photo_urls ?? o.urls ?? o.photos;
    if (nested !== undefined) return photoInputsForPersistence(nested);
    for (const u of normalizePhotoUrls(input)) pushValid(u);
    return out;
  }

  return [];
}

function pickRawPhotos(body: { photoUrls?: unknown; photo_urls?: unknown }): unknown {
  const pu = body.photoUrls;
  const p_ = body.photo_urls;
  const nonEmpty = (u: unknown) => Array.isArray(u) && u.length > 0;
  if (nonEmpty(pu)) return pu;
  if (nonEmpty(p_)) return p_;
  return pu ?? p_ ?? [];
}

function rowToTravelLog(row: TravelLogRow): TravelLog {
  const photoUrls = resolveLogPhotos(row);
  return {
    id: row.id,
    title: row.title,
    date: row.travel_date,
    locationText: row.location_text ?? undefined,
    note: row.note ?? undefined,
    photoUrls,
    createdAt: row.created_at,
  };
}

function rowToTravelLogWithMeta(
  row: TravelLogRow,
  viewerId: string,
  coupleYellowDogId: string | null,
  coupleWhiteDogId: string | null,
): TravelLog {
  const base = rowToTravelLog(row);
  const authorRole = roleForProfileInCouple(row.author_id ?? null, coupleYellowDogId, coupleWhiteDogId);
  const mine = row.author_id != null && row.author_id === viewerId;
  return { ...base, authorRole: authorRole ?? undefined, mine };
}

export async function GET(req: Request) {
  try {
    const gate = await requireCoupleWorkspaceContext(req);
    if (!gate.ok) return gate.response;
    const { supabase, coupleId, userId, role, coupleYellowDogId, coupleWhiteDogId } = gate.ctx;

    const { data: rows, error } = await supabase
      .from("travel_logs")
      .select("*")
      .eq("couple_id", coupleId)
      .order("created_at", { ascending: false });
    if (error) throw error;
    const logs = (rows ?? []).map((r) =>
      rowToTravelLogWithMeta(r as TravelLogRow, userId, coupleYellowDogId, coupleWhiteDogId),
    );
    return NextResponse.json({ ok: true, travelLogs: logs, viewer_role: role });
  } catch (e) {
    return NextResponse.json({ ok: false, error: getErrorMessage(e) }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const gate = await requireCoupleWorkspaceContext(req);
    if (!gate.ok) return gate.response;
    const ctx = gate.ctx;

    const body = (await req.json()) as {
      title?: string;
      date?: string;
      locationText?: string;
      note?: string;
      photoUrls?: unknown;
      photo_urls?: unknown;
    };
    const title = body.title?.trim();
    const date = body.date?.trim();
    if (!title || !date) {
      return NextResponse.json({ ok: false, error: "缺少 title 或 date" }, { status: 400 });
    }
    const rawPhotos = pickRawPhotos(body);
    const dataUrlPhotos = photoInputsForPersistence(rawPhotos);

    const { supabase, coupleId, userId, coupleYellowDogId, coupleWhiteDogId } = ctx;
    const photoUrls = await resolveTravelLogPhotoUrlsForPersistence(supabase, userId, dataUrlPhotos);

    const insertPayload: Record<string, unknown> = {
      couple_id: coupleId,
      author_id: userId,
      title,
      travel_date: date,
      location_text: body.locationText?.trim() || null,
      note: body.note?.trim() || null,
      photo_urls: photoUrls,
    };

    const { data: row, error } = await supabase
      .from("travel_logs")
      .insert(insertPayload)
      .select("*")
      .single();
    if (error) throw error;

    let outRow = row as TravelLogRow;
    let log = rowToTravelLogWithMeta(outRow, userId, coupleYellowDogId, coupleWhiteDogId);
    if (photoUrls.length > 0 && log.photoUrls.length === 0) {
      const { data: patched, error: patchErr } = await supabase
        .from("travel_logs")
        .update({ photo_urls: photoUrls })
        .eq("id", outRow.id)
        .select("*")
        .single();
      if (!patchErr && patched) {
        outRow = patched as TravelLogRow;
        log = rowToTravelLogWithMeta(outRow, userId, coupleYellowDogId, coupleWhiteDogId);
      }
    }

    return NextResponse.json({ ok: true, travelLog: log });
  } catch (e) {
    return NextResponse.json({ ok: false, error: getErrorMessage(e) }, { status: 400 });
  }
}
