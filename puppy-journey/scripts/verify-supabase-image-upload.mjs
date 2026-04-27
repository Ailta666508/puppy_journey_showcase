/**
 * One-off: upload a local image to Supabase Storage (user_uploads) using service role from .env.local.
 * Usage: node scripts/verify-supabase-image-upload.mjs <path-to-image.png>
 */
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

config({ path: path.join(__dirname, "..", ".env.local") });

const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
const bucket =
  process.env.SUPABASE_USER_UPLOADS_BUCKET?.trim() ||
  process.env.NEXT_PUBLIC_SUPABASE_USER_UPLOADS_BUCKET?.trim() ||
  "user_uploads";

const imagePath = process.argv[2];
if (!imagePath || !fs.existsSync(imagePath)) {
  console.error("Usage: node scripts/verify-supabase-image-upload.mjs <absolute-or-relative-image-path>");
  process.exit(1);
}
if (!url || !key) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local");
  process.exit(1);
}

const ext = path.extname(imagePath).slice(1).toLowerCase() || "png";
const mime =
  ext === "jpg" || ext === "jpeg"
    ? "image/jpeg"
    : ext === "webp"
      ? "image/webp"
      : ext === "gif"
        ? "image/gif"
        : "image/png";

const bytes = fs.readFileSync(imagePath);
const objectPath = `verify-agent/${randomUUID()}.${ext === "jpeg" ? "jpg" : ext}`;

const supabase = createClient(url, key, { auth: { persistSession: false } });

const { data, error } = await supabase.storage.from(bucket).upload(objectPath, bytes, {
  contentType: mime,
  upsert: false,
});

if (error) {
  console.error("Upload failed:", error.message);
  process.exit(1);
}

const base = url.replace(/\/+$/, "");
const publicUrl = encodeURI(`${base}/storage/v1/object/public/${bucket}/${objectPath}`);

console.log("OK path:", data?.path ?? objectPath);
console.log("Public URL:", publicUrl);
