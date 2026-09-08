import { describe, expect, it } from "vitest";

import { rehearsalJobOwnedByContext } from "./rehearsalJobAccess";

describe("rehearsalJobOwnedByContext", () => {
  it("allows either member to access a job in their couple workspace", () => {
    expect(
      rehearsalJobOwnedByContext(
        { couple_id: "couple-a", author_id: "partner-profile" },
        "current-profile",
        "couple-a",
      ),
    ).toBe(true);
  });

  it("rejects a job from another couple even when its author id matches", () => {
    expect(
      rehearsalJobOwnedByContext(
        { couple_id: "couple-b", author_id: "current-profile" },
        "current-profile",
        "couple-a",
      ),
    ).toBe(false);
  });

  it("keeps legacy jobs without couple attribution author scoped", () => {
    expect(
      rehearsalJobOwnedByContext(
        { author_id: "current-profile" },
        "current-profile",
        "couple-a",
      ),
    ).toBe(true);
    expect(
      rehearsalJobOwnedByContext(
        { author_id: "other-profile" },
        "current-profile",
        "couple-a",
      ),
    ).toBe(false);
  });
});
