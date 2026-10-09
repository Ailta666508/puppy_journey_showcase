import { beforeEach, describe, expect, it, vi } from "vitest";

const chat = vi.hoisted(() => ({ text: vi.fn(), image: vi.fn() }));
vi.mock("@/lib/pipeline/openaiCompatibleChat", () => ({
  chatCompletionJson: chat.text,
  chatCompletionJsonWithImage: chat.image,
}));

import { generateScript } from "./scriptGenerator";
import { SCRIPT_JSON_CANONICAL_EXAMPLE } from "../prompts";
import { createDubbingPlan } from "@/lib/dubbing/plan";

describe("script generator dubbing metadata", () => {
  beforeEach(() => vi.resetAllMocks());

  it("preserves model role keys and dubbable flags through normalization", async () => {
    chat.text.mockResolvedValue(SCRIPT_JSON_CANONICAL_EXAMPLE);
    const saved = await generateScript({ userText: "咖啡馆点单" });
    expect(saved.script.map((line) => [line.speakerKey, line.dubbable])).toEqual([
      ["npc:waiter", false], ["white_dog", true], ["yellow_dog", true],
    ]);
    expect((await createDubbingPlan(saved)).lines).toHaveLength(3);
    expect(chat.text).toHaveBeenCalledTimes(1);
  });

  it("keeps older metadata-free output readable without silently assigning roles", async () => {
    const legacy = JSON.parse(SCRIPT_JSON_CANONICAL_EXAMPLE);
    for (const line of legacy.script) { delete line.speakerKey; delete line.dubbable; }
    chat.text.mockResolvedValue(JSON.stringify(legacy));
    const saved = await generateScript({});
    expect(saved.script[1]).not.toHaveProperty("speakerKey");
    expect(saved.script[1]).not.toHaveProperty("dubbable");
  });

  it.each([{ speakerKey: "npc:../invalid" }, { dubbable: "true" }])("rejects malformed metadata instead of dropping it", async (change) => {
    const malformed = JSON.parse(SCRIPT_JSON_CANONICAL_EXAMPLE);
    Object.assign(malformed.script[1], change);
    chat.text.mockResolvedValue(JSON.stringify(malformed));
    await expect(generateScript({})).rejects.toThrow();
    expect(chat.text).toHaveBeenCalledTimes(1);
  });

  it("rejects incomplete role assignments before returning a newly generated script", async () => {
    const missingRole = JSON.parse(SCRIPT_JSON_CANONICAL_EXAMPLE);
    missingRole.script.pop();
    chat.text.mockResolvedValue(JSON.stringify(missingRole));
    await expect(generateScript({})).rejects.toMatchObject({ code: "MISSING_DOG_ROLE" });
    expect(chat.text).toHaveBeenCalledTimes(1);
  });
});
