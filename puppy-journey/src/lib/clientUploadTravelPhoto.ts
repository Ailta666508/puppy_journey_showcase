import { getApiErrorField } from "@/lib/getErrorMessage";
import { supabaseBearerHeaders } from "@/lib/supabase/apiSessionHeaders";

async function parseUploadPhotoResponse(res: Response): Promise<string> {
  const data = (await res.json()) as { ok?: boolean; url?: string; error?: string };
  if (!res.ok || !data.ok || !data.url?.trim()) {
    throw new Error(getApiErrorField(data.error, "图片上传失败"));
  }
  return data.url.trim();
}

/** 浏览器 File/Blob → multipart，无 Base64 膨胀，避免单请求体过大（需已登录情侣空间） */
export async function uploadTravelPhotoFile(params: { file: File }): Promise<string> {
  const headers = await supabaseBearerHeaders();
  if (!(headers as Record<string, string>).Authorization) {
    throw new Error("请先登录并加入情侣空间");
  }
  const form = new FormData();
  form.append("file", params.file, params.file.name || "photo.jpg");
  const res = await fetch("/api/travel-logs/upload-photo", {
    method: "POST",
    headers: { ...headers },
    body: form,
  });
  return parseUploadPhotoResponse(res);
}

/** Data URL 先转成 Blob 再走 multipart（Q 版保存等场景） */
export async function uploadTravelPhotoDataUrl(params: {
  dataUrl: string;
  fileName?: string;
}): Promise<string> {
  const headers = await supabaseBearerHeaders();
  if (!(headers as Record<string, string>).Authorization) {
    throw new Error("请先登录并加入情侣空间");
  }
  const r = await fetch(params.dataUrl);
  if (!r.ok) throw new Error("无法解析图片数据");
  const blob = await r.blob();
  const extFromMime = blob.type?.includes("png")
    ? "png"
    : blob.type?.includes("webp")
      ? "webp"
      : blob.type?.includes("gif")
        ? "gif"
        : "jpg";
  const name = params.fileName?.trim() || `photo.${extFromMime}`;
  const form = new FormData();
  form.append("file", blob, name);
  const res = await fetch("/api/travel-logs/upload-photo", {
    method: "POST",
    headers: { ...headers },
    body: form,
  });
  return parseUploadPhotoResponse(res);
}

/** 已是公网或 sb: 引用则不再上传 */
export async function ensureTravelPhotoPublicUrl(dataUrlOrUrl: string, fileName?: string): Promise<string> {
  const t = dataUrlOrUrl.trim();
  if (t.startsWith("http://") || t.startsWith("https://") || t.startsWith("sb:")) return t;
  return uploadTravelPhotoDataUrl({ dataUrl: t, fileName });
}
