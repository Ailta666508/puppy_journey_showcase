import type { DogSpeakerKey, DubbingTimeline } from "./contracts";
import { dubbingDigest } from "./plan";
import { digestDubbingTimeline } from "./timeline";
import { assertDubbingMember, type DubbingActor, type DubbingParticipants } from "./access";

export type RenderTake = {
  id: string;
  sessionId: string;
  planDigest: string;
  lineId: string;
  ownerId: string;
  role: DogSpeakerKey;
  sha256: string;
  durationMs: number;
  status: "ready" | "needs_trim" | "failed" | "revoked";
  visibility: "private" | "shared";
};
export type RenderChoice = { kind: "ai" } | { kind: "take"; takeId: string };
export type DubbingSubmission = {
  ownerId: string;
  role: DogSpeakerKey;
  revision: number;
  choices: Record<string, RenderChoice>;
};
export type RenderManifestLine = {
  lineId: string;
  startMs: number;
  endMs: number;
  source: { kind: "ai"; sha256: string } | { kind: "take"; takeId: string; ownerId: string; sha256: string };
};
export type DubbingRenderManifest = {
  version: 1;
  sessionId: string;
  planDigest: string;
  timelineDigest: string;
  sourceVideoSha256: string;
  participants: DubbingParticipants;
  mode: "solo" | "duet";
  requesterId: string;
  submissions: { ownerId: string; revision: number }[];
  lines: RenderManifestLine[];
  requiredConsentIds: string[];
  digest: string;
};

function invalid(message: string): never { throw new Error(message); }
const HASH = /^[a-f0-9]{64}$/;

/** Produces a snapshot; later selection changes must build a new manifest and consent set. */
export async function buildDubbingRenderManifest(input: {
  sessionId: string;
  participants: DubbingParticipants;
  actor: DubbingActor;
  mode: "solo" | "duet";
  timeline: DubbingTimeline;
  durationConfirmed: boolean;
  sourceVideoSha256: string;
  guideAudioSha256: Record<string, string>;
  submissions: DubbingSubmission[];
  takes: RenderTake[];
}): Promise<DubbingRenderManifest> {
  assertDubbingMember(input.participants, input.actor);
  if (!input.sessionId || !HASH.test(input.sourceVideoSha256) ||
      (input.mode !== "solo" && input.mode !== "duet")) invalid("配音来源无效");
  if (input.timeline.status === "overflow" ||
      (input.timeline.status === "needs_confirmation" && !input.durationConfirmed)) {
    invalid("示范时间线尚未确认");
  }
  const requiredRoles: DogSpeakerKey[] = input.mode === "solo"
    ? [input.actor.role] : ["yellow_dog", "white_dog"];
  const selected = requiredRoles.map((role) => {
    const ownerId = role === "yellow_dog" ? input.participants.yellowDogId : input.participants.whiteDogId;
    const matches = input.submissions.filter((submission) => submission.role === role);
    if (!ownerId || matches.length !== 1) invalid("需要双方分别提交自己的台词");
    const submission = matches[0];
    if (submission.ownerId !== ownerId || !Number.isSafeInteger(submission.revision) || submission.revision < 1) {
      invalid("录音提交版本或所有者不正确");
    }
    const ownLines = input.timeline.lines.filter((line) => line.dubbable && line.speakerKey === role);
    if (!ownLines.length || Object.keys(submission.choices).length !== ownLines.length ||
        !ownLines.every((line) => Object.hasOwn(submission.choices, line.lineId))) {
      invalid("每句台词都需要明确选择真人录音或 AI 示范");
    }
    let humanCount = 0;
    for (const line of ownLines) {
      const choice = submission.choices[line.lineId];
      if (choice.kind === "ai") continue;
      if (choice.kind !== "take") invalid("配音来源无效");
      const takes = input.takes.filter((take) => take.id === choice.takeId);
      if (takes.length !== 1) invalid("录音不存在或已失效");
      const take = takes[0];
      if (take.sessionId !== input.sessionId || take.planDigest !== input.timeline.scriptDigest ||
          take.lineId !== line.lineId || take.ownerId !== ownerId || take.role !== role ||
          take.status !== "ready" || (input.mode === "duet" && take.visibility !== "shared") ||
          !HASH.test(take.sha256) || !Number.isFinite(take.durationMs) ||
          take.durationMs <= 0 || take.durationMs > line.windowMs) {
        invalid("录音未通过窗口、归属或分享检查");
      }
      humanCount++;
    }
    if (!humanCount) invalid("每位真人配音参与者至少需要一句自己的录音");
    return submission;
  });
  const lines = input.timeline.lines.map((line): RenderManifestLine => {
    const submission = selected.find((value) => value.role === line.speakerKey && line.dubbable);
    const choice = submission?.choices[line.lineId];
    if (!choice || choice.kind === "ai") {
      const sha256 = input.guideAudioSha256[line.lineId];
      if (!sha256 || !HASH.test(sha256)) invalid("示范音频尚未完整保存");
      return { lineId: line.lineId, startMs: line.startMs, endMs: line.endMs, source: { kind: "ai", sha256 } };
    }
    const take = input.takes.find((value) => value.id === choice.takeId)!;
    return {
      lineId: line.lineId, startMs: line.startMs, endMs: line.endMs,
      source: { kind: "take", takeId: take.id, ownerId: take.ownerId, sha256: take.sha256 },
    };
  });
  const manifest = {
    version: 1 as const,
    sessionId: input.sessionId,
    planDigest: input.timeline.scriptDigest,
    timelineDigest: await digestDubbingTimeline(input.timeline),
    sourceVideoSha256: input.sourceVideoSha256,
    participants: { ...input.participants },
    mode: input.mode, requesterId: input.actor.userId,
    submissions: selected.map(({ ownerId, revision }) => ({ ownerId, revision })),
    lines,
    requiredConsentIds: selected.map(({ ownerId }) => ownerId).sort(),
  };
  return { ...manifest, digest: await dubbingDigest(JSON.stringify(manifest)) };
}

export type DubbingConsent = { userId: string; digest: string };

export function recordDubbingConsent(
  manifest: DubbingRenderManifest, actor: DubbingActor, expectedDigest: string, previous: DubbingConsent[],
): DubbingConsent[] {
  assertDubbingMember(manifest.participants, actor);
  if (expectedDigest !== manifest.digest || !manifest.requiredConsentIds.includes(actor.userId)) {
    invalid("合成清单已经改变，请重新确认");
  }
  // Never carry a confirmation across manifests, even if some take IDs happen to match.
  return [
    ...previous.filter((entry) => entry.digest === manifest.digest &&
      manifest.requiredConsentIds.includes(entry.userId) && entry.userId !== actor.userId),
    { userId: actor.userId, digest: manifest.digest },
  ];
}

export function hasAllDubbingConsents(manifest: DubbingRenderManifest, consents: DubbingConsent[]): boolean {
  return manifest.requiredConsentIds.length > 0 && manifest.requiredConsentIds.every(
    (id) => consents.some((consent) => consent.userId === id && consent.digest === manifest.digest),
  );
}
