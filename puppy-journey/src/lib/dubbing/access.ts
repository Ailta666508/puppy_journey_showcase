import type { DogSpeakerKey } from "./contracts";

export type DubbingParticipants = {
  coupleId: string;
  yellowDogId: string | null;
  whiteDogId: string | null;
};

export type DubbingActor = DubbingParticipants & {
  userId: string;
  role: DogSpeakerKey;
};

export class DubbingAccessError extends Error {
  constructor() {
    super("配音会话不存在或无权限");
    this.name = "DubbingAccessError";
  }
}

/** Call with current, server-verified member slots; never with request body identities. */
export function assertDubbingMember(snapshot: DubbingParticipants, current: DubbingActor): void {
  const owner = current.role === "yellow_dog" ? snapshot.yellowDogId : snapshot.whiteDogId;
  if (!snapshot.coupleId || !current.userId || snapshot.coupleId !== current.coupleId ||
      snapshot.yellowDogId !== current.yellowDogId || snapshot.whiteDogId !== current.whiteDogId ||
      (current.role !== "yellow_dog" && current.role !== "white_dog") ||
      owner !== current.userId ||
      (snapshot.yellowDogId !== null && snapshot.yellowDogId === snapshot.whiteDogId)) {
    throw new DubbingAccessError();
  }
}

export type DubbingTakeAccess = {
  ownerId: string;
  role: DogSpeakerKey;
  visibility: "private" | "shared" | "revoked";
};

export function canReadDubbingTake(
  take: DubbingTakeAccess, snapshot: DubbingParticipants, actor: DubbingActor,
): boolean {
  try { assertDubbingMember(snapshot, actor); } catch { return false; }
  const owner = take.role === "yellow_dog" ? snapshot.yellowDogId : snapshot.whiteDogId;
  return owner === take.ownerId && take.visibility !== "revoked" &&
    (take.ownerId === actor.userId || take.visibility === "shared");
}

/** Ownership-only revocation intentionally remains available after leaving a couple. */
export function canRevokeDubbingTake(take: Pick<DubbingTakeAccess, "ownerId">, authenticatedUserId: string): boolean {
  return Boolean(authenticatedUserId) && take.ownerId === authenticatedUserId;
}
