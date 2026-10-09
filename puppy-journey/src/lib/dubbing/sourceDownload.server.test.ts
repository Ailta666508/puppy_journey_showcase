import { EventEmitter } from "node:events";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import type { IncomingMessage } from "node:http";
import type { RequestOptions } from "node:https";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ lookup: vi.fn(), request: vi.fn() }));
vi.mock("node:dns/promises", () => ({ lookup: mocks.lookup }));
vi.mock("node:https", () => ({ request: mocks.request }));
import { downloadSourceVideo, isPublicMediaAddress, resolveMediaSource, validateMediaSourceUrl } from "./sourceDownload.server";

const directories: string[] = [];
function response(status = 200, headers: Record<string, string> = {}, bytes = Buffer.from("video-fixture")) {
  return Object.assign(Readable.from([bytes]), { statusCode: status, headers: { "content-type": "video/mp4", ...headers } }) as IncomingMessage;
}
function transport(responses: IncomingMessage[]) {
  mocks.request.mockImplementation((_options: RequestOptions, callback: (response: IncomingMessage) => void) => {
    const req = Object.assign(new EventEmitter(), {
      end: () => queueMicrotask(() => callback(responses.shift()!)), setTimeout: () => req,
      destroy: (error?: Error) => { if (error) req.emit("error", error); return req; },
    });
    return req;
  });
}
async function destination() {
  const directory = await mkdtemp(join(tmpdir(), "dubbing-source-test-")); directories.push(directory);
  return join(directory, "source.mp4");
}
beforeEach(() => {
  mocks.lookup.mockReset().mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
  mocks.request.mockReset();
});
afterEach(async () => {
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
  vi.unstubAllEnvs();
});

describe("source URL boundaries", () => {
  it.each([
    "127.0.0.1", "10.0.0.1", "169.254.169.254", "172.16.0.1", "192.168.1.1", "0.0.0.0",
    "100.64.0.1", "198.19.0.1", "192.0.2.1", "203.0.113.7", "224.0.0.1", "255.255.255.255",
    "::1", "::", "fc00::1", "fe80::1", "::ffff:127.0.0.1", "2002:7f00:1::", "2001:db8::1", "3fff::1",
  ])("rejects nonpublic address %s", (ip) => expect(isPublicMediaAddress(ip)).toBe(false));
  it.each(["93.184.216.34", "1.1.1.1", "2606:4700:4700::1111"])("allows public address %s", (ip) => expect(isPublicMediaAddress(ip)).toBe(true));

  it.each([
    "http://media.example.com/video.mp4", "https://user:pass@media.example.com/video.mp4",
    "https://media.example.com:8443/video.mp4", "https://media.example.com.evil.com/video.mp4",
    "https://127.0.0.1/video.mp4", "https://media.example.com./video.mp4", "file:///tmp/video.mp4",
  ])("rejects URL %s", (url) => expect(() => validateMediaSourceUrl(url, ["media.example.com"])).toThrow());

  it("rejects mixed public/private DNS answers before connecting", async () => {
    mocks.lookup.mockResolvedValue([{ address: "93.184.216.34", family: 4 }, { address: "127.0.0.1", family: 4 }]);
    await expect(resolveMediaSource("https://media.example.com/a", ["media.example.com"])).rejects.toMatchObject({ code: "SOURCE_ADDRESS_NOT_PUBLIC" });
    expect(mocks.request).not.toHaveBeenCalled();
  });
});

describe("bounded provider downloads", () => {
  it("requires an explicit allowlist", async () => {
    vi.stubEnv("DUBBING_SOURCE_ALLOWED_HOSTS", "");
    await expect(downloadSourceVideo({ url: "https://media.example.com/a", destinationPath: await destination() })).rejects.toMatchObject({ code: "SOURCE_ALLOWLIST_MISSING" });
  });

  it("connects to the vetted IP with provider SNI rather than resolving again", async () => {
    transport([response()]);
    const path = await destination();
    const result = await downloadSourceVideo({ url: "https://media.example.com/a?signature=example", destinationPath: path, allowedHosts: ["media.example.com"] });
    expect(await readFile(path, "utf8")).toBe("video-fixture");
    expect(result.bytes).toBe(13);
    expect(mocks.request.mock.calls[0][0]).toMatchObject({ hostname: "93.184.216.34", servername: "media.example.com", headers: { Host: "media.example.com" }, agent: false, rejectUnauthorized: true });
    expect(mocks.lookup).toHaveBeenCalledTimes(1);
  });

  it("rejects redirects to unapproved hosts instead of following them", async () => {
    transport([response(302, { location: "https://internal.example.com/secret" })]);
    const path = await destination();
    await expect(downloadSourceVideo({ url: "https://media.example.com/a", destinationPath: path, allowedHosts: ["media.example.com"] })).rejects.toMatchObject({ code: "SOURCE_HOST_NOT_ALLOWED" });
    expect(mocks.request).toHaveBeenCalledTimes(1);
    await expect(readFile(path)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("revalidates DNS on each redirect", async () => {
    mocks.lookup.mockResolvedValueOnce([{ address: "93.184.216.34", family: 4 }]).mockResolvedValueOnce([{ address: "10.0.0.1", family: 4 }]);
    transport([response(302, { location: "/redirected" })]);
    await expect(downloadSourceVideo({ url: "https://media.example.com/a", destinationPath: await destination(), allowedHosts: ["media.example.com"] })).rejects.toMatchObject({ code: "SOURCE_ADDRESS_NOT_PUBLIC" });
    expect(mocks.request).toHaveBeenCalledTimes(1);
  });

  it("rejects excessive declared size without writing a file", async () => {
    transport([response(200, { "content-length": String(64 * 1024 * 1024 + 1) })]);
    await expect(downloadSourceVideo({ url: "https://media.example.com/a", destinationPath: await destination(), allowedHosts: ["media.example.com"] })).rejects.toMatchObject({ code: "SOURCE_RESPONSE_REJECTED" });
  });

  it("removes incomplete downloads", async () => {
    transport([response(200, { "content-length": "20" })]);
    const path = await destination();
    await expect(downloadSourceVideo({ url: "https://media.example.com/a", destinationPath: path, allowedHosts: ["media.example.com"] })).rejects.toMatchObject({ code: "SOURCE_INCOMPLETE" });
    await expect(readFile(path)).rejects.toMatchObject({ code: "ENOENT" });
  });
});
