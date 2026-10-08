import { createHash } from "node:crypto";
import { lookup } from "node:dns/promises";
import { createWriteStream } from "node:fs";
import { lstat, rm } from "node:fs/promises";
import { request } from "node:https";
import { isIP } from "node:net";
import { isAbsolute } from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { IncomingMessage } from "node:http";

export class SourceDownloadError extends Error {
  constructor(public readonly code: string) { super(code); this.name = "SourceDownloadError"; }
}

/** Reject special-use addresses, including IPv4-embedded IPv6, before opening a socket. */
export function isPublicMediaAddress(address: string): boolean {
  if (isIP(address) === 4) {
    const [a, b, c] = address.split(".").map(Number);
    return !(a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) ||
      (a === 192 && b === 0) || (a === 192 && b === 88 && c === 99) ||
      (a === 198 && (b === 18 || b === 19)) || (a === 198 && b === 51 && c === 100) ||
      (a === 203 && b === 0 && c === 113));
  }
  if (isIP(address) !== 6 || address.includes(".") || address.includes("%")) return false;
  const [left, right = ""] = address.toLowerCase().split("::");
  const prefix = left ? left.split(":") : [];
  const suffix = right ? right.split(":") : [];
  const groups = address.includes("::") ? [...prefix, ...Array(8 - prefix.length - suffix.length).fill("0"), ...suffix] : prefix;
  const first = parseInt(groups[0], 16);
  const second = parseInt(groups[1], 16);
  // Only ordinary global unicast; exclude IETF special, documentation, and 6to4 ranges.
  return first >= 0x2000 && first <= 0x3fff && first !== 0x2002 &&
    !(first === 0x2001 && (second <= 0x1ff || second === 0xdb8)) &&
    !(first === 0x3fff && second <= 0x0fff);
}

export function validateMediaSourceUrl(raw: string, allowedHosts: readonly string[]): URL {
  let url: URL;
  try { url = new URL(raw); } catch { throw new SourceDownloadError("INVALID_SOURCE_URL"); }
  const hosts = allowedHosts.map((host) => host.trim().toLowerCase()).filter(Boolean);
  if (url.protocol !== "https:" || url.username || url.password || url.hash ||
    (url.port && url.port !== "443") || isIP(url.hostname.replace(/^\[|\]$/g, "")) ||
    !hosts.includes(url.hostname.toLowerCase()) || url.hostname.endsWith(".")) {
    throw new SourceDownloadError("SOURCE_HOST_NOT_ALLOWED");
  }
  return url;
}

export async function resolveMediaSource(raw: string, allowedHosts: readonly string[], signal?: AbortSignal) {
  const url = validateMediaSourceUrl(raw, allowedHosts);
  const addresses = await new Promise<Awaited<ReturnType<typeof lookup>>[]>((resolve, reject) => {
    const abort = () => reject(new SourceDownloadError("SOURCE_DOWNLOAD_TIMEOUT"));
    if (signal?.aborted) return abort();
    signal?.addEventListener("abort", abort, { once: true });
    lookup(url.hostname, { all: true, verbatim: true }).then(resolve, reject).finally(() => signal?.removeEventListener("abort", abort));
  });
  if (!addresses.length || addresses.some(({ address }) => !isPublicMediaAddress(address))) {
    throw new SourceDownloadError("SOURCE_ADDRESS_NOT_PUBLIC");
  }
  const target = addresses.find((entry) => entry.family === 4) || addresses[0];
  return { url, address: target.address, family: target.family };
}

function openPinned(target: Awaited<ReturnType<typeof resolveMediaSource>>, signal: AbortSignal) {
  return new Promise<IncomingMessage>((resolve, reject) => {
    // Connect to the vetted IP; SNI and Host retain the provider hostname for TLS verification/routing.
    const req = request({
      protocol: "https:", hostname: target.address, family: target.family, port: 443,
      servername: target.url.hostname, path: target.url.pathname + target.url.search,
      method: "GET", agent: false, rejectUnauthorized: true, signal,
      headers: { Host: target.url.host, Accept: "video/mp4,video/webm,application/octet-stream", "Accept-Encoding": "identity" },
    }, resolve);
    req.on("error", reject);
    req.setTimeout(15_000, () => req.destroy(new SourceDownloadError("SOURCE_DOWNLOAD_TIMEOUT")));
    req.end();
  });
}

export async function downloadSourceVideo(args: {
  url: string;
  destinationPath: string;
  allowedHosts?: readonly string[];
  signal?: AbortSignal;
}) {
  const hosts = args.allowedHosts ?? (process.env.DUBBING_SOURCE_ALLOWED_HOSTS || "").split(",");
  if (!hosts.some((host) => host.trim())) throw new SourceDownloadError("SOURCE_ALLOWLIST_MISSING");
  if (!isAbsolute(args.destinationPath) || args.destinationPath.includes("\0")) throw new SourceDownloadError("INVALID_DESTINATION");
  try {
    await lstat(args.destinationPath);
    throw new SourceDownloadError("DESTINATION_EXISTS");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60_000);
  const abort = () => controller.abort();
  if (args.signal?.aborted) controller.abort();
  args.signal?.addEventListener("abort", abort, { once: true });
  let created = false;
  try {
    let next = args.url;
    for (let redirects = 0; redirects <= 3; redirects++) {
      const target = await resolveMediaSource(next, hosts, controller.signal);
      controller.signal.throwIfAborted();
      const response = await openPinned(target, controller.signal);
      if ([301, 302, 303, 307, 308].includes(response.statusCode || 0)) {
        response.destroy();
        if (!response.headers.location || redirects === 3) throw new SourceDownloadError("SOURCE_REDIRECT_LIMIT");
        next = new URL(response.headers.location, target.url).href;
        continue;
      }
      const contentType = (response.headers["content-type"] || "").split(";")[0].trim().toLowerCase();
      const length = Number(response.headers["content-length"]);
      const maxBytes = 64 * 1024 * 1024;
      if (response.statusCode !== 200 || !["video/mp4", "video/webm", "application/octet-stream"].includes(contentType) ||
        (response.headers["content-encoding"] && response.headers["content-encoding"] !== "identity") ||
        (Number.isFinite(length) && length > maxBytes)) {
        response.destroy();
        throw new SourceDownloadError("SOURCE_RESPONSE_REJECTED");
      }
      let bytes = 0;
      const hash = createHash("sha256");
      const bounded = new Transform({ transform(chunk: Buffer, _encoding, callback) {
        bytes += chunk.length;
        if (bytes > maxBytes) return callback(new SourceDownloadError("SOURCE_TOO_LARGE"));
        hash.update(chunk);
        callback(null, chunk);
      } });
      const file = createWriteStream(args.destinationPath, { flags: "wx", mode: 0o600 });
      file.once("open", () => { created = true; });
      await pipeline(response, bounded, file, { signal: controller.signal });
      if (!bytes || (response.headers["content-length"] && bytes !== length)) throw new SourceDownloadError("SOURCE_INCOMPLETE");
      return { bytes, sha256: hash.digest("hex") };
    }
    throw new SourceDownloadError("SOURCE_REDIRECT_LIMIT");
  } catch (error) {
    if (created) await rm(args.destinationPath, { force: true });
    if (error instanceof SourceDownloadError) throw error;
    throw new SourceDownloadError(controller.signal.aborted ? "SOURCE_DOWNLOAD_TIMEOUT" : "SOURCE_DOWNLOAD_FAILED");
  } finally {
    clearTimeout(timer);
    args.signal?.removeEventListener("abort", abort);
  }
}
