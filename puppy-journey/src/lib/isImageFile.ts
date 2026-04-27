/** 与部分浏览器对 HEIC 等类型 MIME 为空的情况兼容：除 image/* 外按扩展名判断 */
export function isImageFile(file: File): boolean {
  if (file.type.startsWith("image/")) return true;
  const n = file.name.toLowerCase();
  return /\.(heic|heif|jpg|jpeg|jfif|png|gif|webp|bmp|svg|avif|tiff|tif)$/.test(n);
}
