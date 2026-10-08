import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { DubbingRenderManifest } from "@/lib/dubbing/renderPlan";

import { DubbingRenderCard } from "./DubbingRenderCard";
import { DubbingTakeCard } from "./DubbingTakeCard";
import { RoleRecorder } from "./RoleRecorder";
import { choicesAreReady, dubbingFailureLabel, parseStudioSnapshot, safeStudioMediaUrl, studioHasPendingWork, runGuardedNavigation, type StudioSnapshot, type StudioRender } from "./studioClient";

function snapshot(): StudioSnapshot {
  return {
    ok: true, capabilities: { enabled: true, ttsMode: "mock" },
    userId: "me", myRole: "yellow_dog",
    plan: {
      planVersion: 1, locale: "es-ES", scriptDigest: "a".repeat(64),
      lines: [
        { lineId: "line-1", ordinal: 0, speakerKey: "yellow_dog", dubbable: true, text: "Un café, por favor.", translation: "一杯咖啡，谢谢。", voicePreset: "yellow_dog" },
        { lineId: "line-2", ordinal: 1, speakerKey: "white_dog", dubbable: true, text: "Para mí, un té.", voicePreset: "white_dog" },
      ],
    },
    guide: null, session: null, takes: [], partnerProgress: { ready: 0, total: 1 }, mySubmission: null, renders: [],
  };
}

function render(): StudioRender {
  return {
    id: "render-one", status: "awaiting_consent", mode: "solo", manifestDigest: "b".repeat(64),
    requiredConsentIds: ["me"], consentedBy: [],
  };
}

function manifest(): DubbingRenderManifest {
  return {
    version: 1, sessionId: "session-one", planDigest: "a".repeat(64), timelineDigest: "c".repeat(64), sourceVideoSha256: "d".repeat(64),
    participants: { coupleId: "couple-one", yellowDogId: "me", whiteDogId: "partner" },
    mode: "solo", requesterId: "me", submissions: [{ ownerId: "me", revision: 1 }],
    lines: [{ lineId: "line-1", startMs: 150, endMs: 2150, source: { kind: "take", takeId: "take-one", ownerId: "me", sha256: "e".repeat(64) } }],
    requiredConsentIds: ["me"], digest: "b".repeat(64),
  };
}

describe("studio response and progress", () => {
  it("parses the authenticated, explicitly configured response", () => {
    const value = snapshot();
    expect(parseStudioSnapshot(value)).toEqual(value);
    expect(parseStudioSnapshot({ ...value, capabilities: { enabled: false, ttsMode: "disabled" } }).capabilities.enabled).toBe(false);
  });

  it.each([
    { ok: false }, { myRole: "admin" }, { capabilities: undefined },
    { capabilities: { enabled: "true", ttsMode: "mock" } },
    { takes: [{ id: "other", lineId: "line-1", status: "ready" }] },
    { renders: [{ ...render(), status: "probably-finished" }] },
    { guide: { id: "guide", status: "complete" } },
    { session: {} }, { partnerProgress: { ready: "1", total: 1 } },
  ])("rejects malformed state %j instead of presenting it as ready", (overrides) => {
    expect(() => parseStudioSnapshot({ ...snapshot(), ...overrides })).toThrow();
  });

  it("polls actual pending work and shared handoffs, not idle private drafts", () => {
    const state = snapshot();
    expect(studioHasPendingWork(state)).toBe(false);
    expect(studioHasPendingWork({ ...state, guide: { id: "guide", status: "queued" } })).toBe(true);
    expect(studioHasPendingWork({ ...state, guide: { id: "guide", status: "awaiting_confirmation" } })).toBe(false);
    expect(studioHasPendingWork({ ...state, takes: [{ id: "take", ownerId: "me", lineId: "line-1", status: "validating" }] })).toBe(true);
    expect(studioHasPendingWork({ ...state, renders: [render()] })).toBe(true);
    expect(studioHasPendingWork({ ...state, mySubmission: { revision: 1, choices: {}, shared: false } })).toBe(false);
    expect(studioHasPendingWork({ ...state, mySubmission: { revision: 1, choices: {}, shared: true } })).toBe(true);
  });

  it("requires an explicit choice for every own line, and allows explicit AI choices", () => {
    const state = snapshot();
    expect(choicesAreReady(state, {})).toBe(false);
    expect(choicesAreReady(state, { "line-1": { kind: "ai" } })).toBe(true);
    expect(choicesAreReady(state, { "line-1": { kind: "ai" }, "line-2": { kind: "ai" } })).toBe(false);
  });

  it("allows only a ready take owned by this user for this exact line", () => {
    const state = snapshot();
    state.takes = [{ id: "take", ownerId: "me", lineId: "line-1", status: "ready" }];
    const choices = { "line-1": { kind: "take" as const, takeId: "take" } };
    expect(choicesAreReady(state, choices)).toBe(true);
    for (const invalid of [
      { ownerId: "partner" }, { lineId: "line-2" }, { status: "needs_trim" as const }, { status: "failed" as const }, { status: "revoked" as const },
    ]) expect(choicesAreReady({ ...state, takes: [{ ...state.takes[0], ...invalid }] }, choices)).toBe(false);
  });

  it.each(["javascript:alert(1)", "data:audio/wav;base64,AA", "//third-party.test/track", "/\\evil.test/audio", "not a URL", "http://remote.test/audio"])("does not create a media request for %s", (url) => {
    expect(safeStudioMediaUrl(url)).toBeUndefined();
  });

  it("supports signed HTTPS, application paths, and local test URLs", () => {
    for (const url of ["https://storage.test/audio?token=abc", "/api/dubbing/asset", "http://127.0.0.1:54321/test"]) {
      expect(safeStudioMediaUrl(url)).toBe(url);
    }
  });

  it("does not expose arbitrary worker errors and explicitly warns about unknown TTS delivery", () => {
    expect(dubbingFailureLabel("private-provider-token")).not.toContain("private-provider-token");
    expect(dubbingFailureLabel("__proto__")).toEqual(expect.any(String));
    expect(dubbingFailureLabel("TTS_DELIVERY_UNKNOWN")).toContain("可能已产生费用");
  });
});

describe("role dubbing markup safeguards", () => {
  const callbacks = { onConsent: vi.fn(), onCancel: vi.fn(), onRetry: vi.fn() };

  it("does not offer blind consent without a digest-bound immutable manifest", () => {
    const html = renderToStaticMarkup(<DubbingRenderCard render={render()} plan={snapshot().plan} userId="me" synthetic={false} busy={false} {...callbacks} />);
    expect(html).toContain("成片清单尚未完整读取");
    expect(html).not.toContain("确认这份清单</button>");
  });

  it("shows exact take versions and requires a separate unchecked consent", () => {
    const html = renderToStaticMarkup(<DubbingRenderCard render={{ ...render(), manifest: manifest() }} plan={snapshot().plan} userId="me" synthetic={false} busy={false} {...callbacks} />);
    expect(html).toContain("我的声音 · 录音 take-one");
    expect(html).toContain("disabled=\"\"");
    expect(html).not.toContain("checked=\"\"");
    expect(html).toContain("确认这份清单");
  });

  it("keeps a mismatched manifest unconfirmable and hides another requester's cancel action", () => {
    const html = renderToStaticMarkup(<DubbingRenderCard render={{ ...render(), manifest: { ...manifest(), digest: "different", requesterId: "partner" } }} plan={snapshot().plan} userId="me" synthetic={false} busy={false} {...callbacks} />);
    expect(html).not.toContain("确认这份清单</button>");
    expect(html).not.toContain("取消这次合成</button>");
  });

  it("labels synthetic media and only exposes a download when attachment URL exists", () => {
    const base = { ...render(), status: "completed" as const, videoUrl: "https://storage.test/video.mp4" };
    const html = renderToStaticMarkup(<DubbingRenderCard render={base} plan={snapshot().plan} userId="me" synthetic busy={false} {...callbacks} />);
    expect(html).toContain("合成提示音，不用于发音学习");
    expect(html).not.toContain("下载 MP4");
    const downloadable = renderToStaticMarkup(<DubbingRenderCard render={{ ...base, downloadUrl: "https://storage.test/video.mp4?download=1" }} plan={snapshot().plan} userId="me" synthetic busy={false} {...callbacks} />);
    expect(downloadable).toContain("下载 MP4");
  });

  it("keeps needs-trim takes separate from valid choices and requires audition before trim", () => {
    const html = renderToStaticMarkup(<DubbingTakeCard take={{ id: "take-one", ownerId: "me", lineId: "line-1", status: "needs_trim", durationMs: 3200, audioUrl: "/audio.wav" }} windowMs={2000} busy={false} onTrim={vi.fn()} onRevoke={vi.fn()} onRetry={vi.fn()} />);
    expect(html).toContain("待裁剪");
    expect(html).toContain("裁剪后不超过 2.0 秒");
    expect(html).toContain("disabled=\"\"");
  });

  it("never requests microphone access or offers save on initial render", () => {
    const html = renderToStaticMarkup(<RoleRecorder lineId="line-1" text="Hola." windowMs={2000} onSave={vi.fn()} />);
    expect(html).toContain("开始录音");
    expect(html).not.toContain("保存这一句</button>");
    expect(html).toContain("点击保存后才上传");
  });
});

describe("recording navigation guard", () => {
  it.each(["返回新建", "词汇卡"])("does not leave via %s when discarding the local recording is cancelled", () => {
    const navigate = vi.fn();
    const confirmDiscard = vi.fn(() => false);
    expect(runGuardedNavigation(confirmDiscard, navigate)).toBe(false);
    expect(confirmDiscard).toHaveBeenCalledOnce();
    expect(navigate).not.toHaveBeenCalled();
  });

  it("leaves once after explicit discard, and allows navigation with no open recorder", () => {
    const navigate = vi.fn();
    expect(runGuardedNavigation(() => true, navigate)).toBe(true);
    expect(navigate).toHaveBeenCalledOnce();
    navigate.mockClear();
    expect(runGuardedNavigation(null, navigate)).toBe(true);
    expect(navigate).toHaveBeenCalledOnce();
  });

  it("keeps embedded render previews in the theater instead of duplicating a player", () => {
    const html = renderToStaticMarkup(<DubbingRenderCard render={{ ...render(), status: "completed", videoUrl: "https://storage.test/video.mp4" }} plan={snapshot().plan} userId="me" synthetic busy={false} onPreview={vi.fn()} onConsent={vi.fn()} onCancel={vi.fn()} onRetry={vi.fn()} />);
    expect(html).toContain("在剧场播放");
    expect(html).not.toContain("<video");
  });
});
