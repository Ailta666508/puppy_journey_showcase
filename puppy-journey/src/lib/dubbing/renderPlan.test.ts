import { describe, expect, it } from "vitest";
import { assertDubbingMember, canReadDubbingTake, canRevokeDubbingTake, type DubbingActor } from "./access";
import { buildDubbingRenderManifest, hasAllDubbingConsents, recordDubbingConsent, type RenderTake } from "./renderPlan";
import { buildDubbingTimeline } from "./timeline";
import type { DubbingPlan } from "./contracts";

const participants = { coupleId: "couple", yellowDogId: "yellow", whiteDogId: "white" };
const yellow: DubbingActor = { ...participants, userId: "yellow", role: "yellow_dog" };
const white: DubbingActor = { ...participants, userId: "white", role: "white_dog" };
const plan: DubbingPlan = {
  planVersion: 1, locale: "es-ES", scriptDigest: "a".repeat(64),
  lines: [
    { lineId: "line-1", ordinal: 0, speakerKey: "yellow_dog", dubbable: true, text: "Hola.", voicePreset: "yellow_dog" },
    { lineId: "line-2", ordinal: 1, speakerKey: "white_dog", dubbable: true, text: "Buenos días.", voicePreset: "white_dog" },
    { lineId: "line-3", ordinal: 2, speakerKey: "npc:waiter", dubbable: false, text: "Un café.", voicePreset: "npc" },
  ],
};
function input(): Parameters<typeof buildDubbingRenderManifest>[0] {
  const takes: RenderTake[] = [
    { id: "take-y", sessionId: "session", planDigest: plan.scriptDigest, lineId: "line-1", ownerId: "yellow", role: "yellow_dog", sha256: "b".repeat(64), durationMs: 1200, status: "ready", visibility: "shared" },
    { id: "take-w", sessionId: "session", planDigest: plan.scriptDigest, lineId: "line-2", ownerId: "white", role: "white_dog", sha256: "c".repeat(64), durationMs: 1100, status: "ready", visibility: "shared" },
  ];
  return {
    sessionId: "session", participants, actor: yellow, mode: "duet" as "solo" | "duet",
    timeline: buildDubbingTimeline(plan, plan.lines.map(({ lineId }) => ({ lineId, durationMs: 1000 })), 8000),
    durationConfirmed: false, sourceVideoSha256: "d".repeat(64),
    guideAudioSha256: Object.fromEntries(plan.lines.map(({ lineId }) => [lineId, "e".repeat(64)])),
    submissions: [
      { ownerId: "yellow", role: "yellow_dog" as const, revision: 1, choices: { "line-1": { kind: "take" as const, takeId: "take-y" } } },
      { ownerId: "white", role: "white_dog" as const, revision: 1, choices: { "line-2": { kind: "take" as const, takeId: "take-w" } } },
    ], takes,
  };
}

describe("dubbing membership and private recordings", () => {
  it("permits current members but never a new partner to inherit an old session", () => {
    expect(() => assertDubbingMember(participants, yellow)).not.toThrow();
    for (const actor of [
      { ...yellow, coupleId: "other" }, { ...yellow, whiteDogId: "new-partner" },
      { ...yellow, userId: "white" }, { ...yellow, userId: "" },
    ]) expect(() => assertDubbingMember(participants, actor)).toThrow();
  });
  it("keeps unsubmitted audio private and rejects revoked/shared audio after membership changes", () => {
    const take = { ownerId: "yellow", role: "yellow_dog" as const, visibility: "private" as const };
    expect(canReadDubbingTake(take, participants, yellow)).toBe(true);
    expect(canReadDubbingTake(take, participants, white)).toBe(false);
    expect(canReadDubbingTake({ ...take, visibility: "shared" }, participants, white)).toBe(true);
    expect(canReadDubbingTake({ ...take, visibility: "revoked" }, participants, yellow)).toBe(false);
    expect(canReadDubbingTake({ ...take, visibility: "shared" }, participants, { ...white, yellowDogId: null })).toBe(false);
    expect(canReadDubbingTake({ ...take, ownerId: "intruder", visibility: "shared" }, participants, white)).toBe(false);
  });
  it("allows ownership-only deletion after leaving, but not another user's deletion", () => {
    expect(canRevokeDubbingTake({ ownerId: "yellow" }, "yellow")).toBe(true);
    expect(canRevokeDubbingTake({ ownerId: "yellow" }, "white")).toBe(false);
    expect(canRevokeDubbingTake({ ownerId: "" }, "")).toBe(false);
  });
});

describe("immutable rendering consent", () => {
  it("solo uses only the requester's takes and keeps the partner and NPC guide voices", async () => {
    const value = input(); value.mode = "solo"; value.takes[0].visibility = "private";
    const manifest = await buildDubbingRenderManifest(value);
    expect(manifest.lines.map((line) => line.source.kind)).toEqual(["take", "ai", "ai"]);
    expect(manifest.requiredConsentIds).toEqual(["yellow"]);
    expect(manifest.submissions).toEqual([{ ownerId: "yellow", revision: 1 }]);
  });
  it("duet requires both independent consent records for the exact manifest", async () => {
    const manifest = await buildDubbingRenderManifest(input());
    let consents = recordDubbingConsent(manifest, yellow, manifest.digest, []);
    expect(hasAllDubbingConsents(manifest, consents)).toBe(false);
    consents = recordDubbingConsent(manifest, white, manifest.digest, consents);
    expect(hasAllDubbingConsents(manifest, consents)).toBe(true);
    expect(recordDubbingConsent(manifest, white, manifest.digest, consents)).toHaveLength(2);
    expect(() => recordDubbingConsent(manifest, white, "stale", consents)).toThrow();
    expect(() => recordDubbingConsent(manifest, { ...white, yellowDogId: null }, manifest.digest, consents)).toThrow();
  });
  it.each(["private", "needs_trim", "wrong_owner", "wrong_line", "wrong_session", "wrong_plan", "too_long", "bad_hash", "duplicate"])("rejects unsafe take: %s", async (reason) => {
    const value = input(); const take = value.takes[0];
    if (reason === "private") take.visibility = "private";
    if (reason === "needs_trim") take.status = "needs_trim";
    if (reason === "wrong_owner") take.ownerId = "white";
    if (reason === "wrong_line") take.lineId = "line-2";
    if (reason === "wrong_session") take.sessionId = "different";
    if (reason === "wrong_plan") take.planDigest = "f".repeat(64);
    if (reason === "too_long") take.durationMs = 10001;
    if (reason === "bad_hash") take.sha256 = "bad";
    if (reason === "duplicate") value.takes.push({ ...take });
    await expect(buildDubbingRenderManifest(value)).rejects.toThrow();
  });
  it("requires explicit line choices and at least one human recording per participating role", async () => {
    const value = input(); value.submissions[0].choices = {};
    await expect(buildDubbingRenderManifest(value)).rejects.toThrow();
    const allAI = input();
    const aiSubmission = { ...allAI.submissions[0], choices: { "line-1": { kind: "ai" as const } } };
    await expect(buildDubbingRenderManifest({ ...allAI, submissions: [aiSubmission, allAI.submissions[1]] })).rejects.toThrow();
    await expect(buildDubbingRenderManifest({ ...input(), submissions: input().submissions.slice(0, 1) })).rejects.toThrow();
  });
  it("cannot render unconfirmed extensions or overflow", async () => {
    const value = input(); value.timeline.status = "needs_confirmation";
    await expect(buildDubbingRenderManifest(value)).rejects.toThrow();
    value.durationConfirmed = true;
    await expect(buildDubbingRenderManifest(value)).resolves.toHaveProperty("digest");
    value.timeline.status = "overflow";
    await expect(buildDubbingRenderManifest(value)).rejects.toThrow();
  });
  it.each(["source", "guide", "take", "revision", "timeline"])("invalidates old consent after %s changes", async (changed) => {
    const value = input(); const before = await buildDubbingRenderManifest(value);
    if (changed === "source") value.sourceVideoSha256 = "f".repeat(64);
    if (changed === "guide") value.guideAudioSha256["line-3"] = "f".repeat(64);
    if (changed === "take") value.takes[0].sha256 = "f".repeat(64);
    if (changed === "revision") value.submissions[0].revision++;
    if (changed === "timeline") value.timeline.lines[0].endMs++;
    const after = await buildDubbingRenderManifest(value);
    expect(after.digest).not.toBe(before.digest);
    expect(hasAllDubbingConsents(after, before.requiredConsentIds.map((userId) => ({ userId, digest: before.digest })))).toBe(false);
    expect(recordDubbingConsent(after, yellow, after.digest, [{ userId: "white", digest: before.digest }])).toEqual([{ userId: "yellow", digest: after.digest }]);
  });
});
