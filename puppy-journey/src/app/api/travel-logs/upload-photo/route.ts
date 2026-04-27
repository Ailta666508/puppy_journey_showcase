import { NextResponse } from "next/server";

import { requireCoupleWorkspaceContext } from "@/lib/couple/coupleWorkspaceContext";
import { getErrorMessage, getApiErrorField } from "@/lib/getErrorMessage";
import { createSupabaseUserClientFromBearer } from "@/lib/supabase/userSupabaseFromBearer";
import { uploadImageBufferToUserUploads, uploadTravelDataUrlToUserUploads } from "@/lib/travelUserUploadsStorage";

export const runtime = "nodejs";

function bearerToken(req: Request): string {
  const h = req.headers.get("authorization") ?? "";
  return h.startsWith("Bearer ") ? h.slice(7).trim() : "";
}

/** 先 service role；若 Storage 报权限类错误则改用用户 JWT（需已执行 user_uploads 的 authenticated 策略） */
async function uploadBytesWithFallback(
  req: Request,
  serviceSb: Parameters<typeof uploadImageBufferToUserUploads>[0],
  userId: string,
  bytes: Buffer,
  contentType: string | undefined,
  fileName: string,
): Promise<string> {
  try {
    return await uploadImageBufferToUserUploads(serviceSb, userId, bytes, contentType, fileName);
  } catch (serviceErr) {
    const msg = getErrorMessage(serviceErr).toLowerCase();
    const maybeRls =
      msg.includes("row-level security") ||
      msg.includes("rls") ||
      msg.includes("policy") ||
      msg.includes("permission") ||
      msg.includes("denied") ||
      msg.includes("unauthorized");
    const token = bearerToken(req);
    if (!maybeRls || !token) throw serviceErr;
    return await uploadImageBufferToUserUploads(
      createSupabaseUserClientFromBearer(token),
      userId,
      bytes,
      contentType,
      fileName,
    );
  }
}

async function uploadDataUrlWithFallback(
  req: Request,
  serviceSb: Parameters<typeof uploadTravelDataUrlToUserUploads>[0],
  userId: string,
  dataUrl: string,
  fileName?: string,
): Promise<string> {
  try {
    return await uploadTravelDataUrlToUserUploads(serviceSb, userId, dataUrl, fileName);
  } catch (serviceErr) {
    const msg = getErrorMessage(serviceErr).toLowerCase();
    const maybeRls =
      msg.includes("row-level security") ||
      msg.includes("rls") ||
      msg.includes("policy") ||
      msg.includes("permission") ||
      msg.includes("denied") ||
      msg.includes("unauthorized");
    const token = bearerToken(req);
    if (!maybeRls || !token) throw serviceErr;
    return await uploadTravelDataUrlToUserUploads(
      createSupabaseUserClientFromBearer(token),
      userId,
      dataUrl,
      fileName,
    );
  }
}

export async function POST(req: Request) {
  try {
    const gate = await requireCoupleWorkspaceContext(req);
    if (!gate.ok) return gate.response;
    const { supabase, userId } = gate.ctx;

    const ct = (req.headers.get("content-type") || "").toLowerCase();

    if (ct.includes("multipart/form-data")) {
      const form = await req.formData();
      const fileEntry = form.get("file");
      if (fileEntry == null || typeof fileEntry === "string") {
        return NextResponse.json({ ok: false, error: "缺少 file" }, { status: 400 });
      }
      if (!(fileEntry instanceof Blob)) {
        return NextResponse.json({ ok: false, error: "file 无效" }, { status: 400 });
      }
      const nameFromForm = form.get("fileName");
      const fileName =
        typeof nameFromForm === "string" && nameFromForm.trim()
          ? nameFromForm.trim()
          : fileEntry instanceof File && fileEntry.name
            ? fileEntry.name
            : "photo.jpg";
      const ab = await fileEntry.arrayBuffer();
      const bytes = Buffer.from(ab);
      const declaredType = fileEntry instanceof File ? fileEntry.type : undefined;
      const url = await uploadBytesWithFallback(req, supabase, userId, bytes, declaredType, fileName);
      return NextResponse.json({ ok: true, url });
    }

    const body = (await req.json()) as {
      dataUrl?: unknown;
      fileName?: unknown;
    };
    const dataUrl = typeof body.dataUrl === "string" ? body.dataUrl.trim() : "";
    if (!dataUrl.startsWith("data:")) {
      return NextResponse.json({ ok: false, error: "缺少有效的 dataUrl" }, { status: 400 });
    }
    const fileName = typeof body.fileName === "string" ? body.fileName.trim() : undefined;

    const url = await uploadDataUrlWithFallback(req, supabase, userId, dataUrl, fileName);

    return NextResponse.json({ ok: true, url });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: getApiErrorField(getErrorMessage(e), "图片上传失败") },
      { status: 400 },
    );
  }
}
