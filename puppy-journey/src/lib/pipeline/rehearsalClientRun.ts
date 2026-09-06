export type RehearsalScriptRequestBody = {
  user_text: string;
  image_description: string;
  user_image_data_url: string;
  user_image_url: string;
  context_achievements: string;
  context_travel: string;
  context_wishes: string;
  idempotency_key: string;
  retry_failed?: true;
};

type ScriptInputFields = Omit<
  RehearsalScriptRequestBody,
  "idempotency_key" | "retry_failed"
>;

export function createRehearsalScriptRequest(
  input: ScriptInputFields,
  idempotencyKey: string,
): RehearsalScriptRequestBody {
  const key = idempotencyKey.trim();
  if (!key) throw new Error("A rehearsal idempotency key is required");
  return { ...input, idempotency_key: key };
}

export function asFailedRehearsalScriptRetry(
  request: RehearsalScriptRequestBody,
): RehearsalScriptRequestBody {
  return { ...request, retry_failed: true };
}
