/**
 * 用于 `new Image()` 或任何依赖 `load` / `decode` 的程序化解码路径，
 * 减轻 Chromium 对「懒加载占位」的干预导致 load 事件长期推迟的问题。
 */
export function prepareEagerImageDecode(img: HTMLImageElement): void {
  img.loading = "eager";
  img.decoding = "sync";
}
