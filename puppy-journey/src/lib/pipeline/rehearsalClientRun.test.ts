import { describe, expect, it } from "vitest";

import {
  asFailedRehearsalScriptRetry,
  createRehearsalScriptRequest,
} from "./rehearsalClientRun";

const input = {
  user_text: "Practise ordering coffee",
  image_description: "A quiet café",
  user_image_data_url: "",
  user_image_url: "",
  context_achievements: "",
  context_travel: "Madrid",
  context_wishes: "",
};

describe("rehearsal client run", () => {
  it("reuses the exact payload and idempotency key for failed-stage retry", () => {
    const original = createRehearsalScriptRequest(input, " run-2026-09-06 ");
    const retry = asFailedRehearsalScriptRetry(original);

    expect(retry).toEqual({ ...original, retry_failed: true });
    expect(retry.idempotency_key).toBe("run-2026-09-06");
    expect(original.retry_failed).toBeUndefined();
  });

  it("rejects a request that cannot be replayed idempotently", () => {
    expect(() => createRehearsalScriptRequest(input, "   ")).toThrow(
      "idempotency key is required",
    );
  });
});
