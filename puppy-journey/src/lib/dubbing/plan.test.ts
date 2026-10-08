import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { DubbingPlanError } from "./contracts";
import { createDubbingPlan, dubbingDigest, parseDubbingScript } from "./plan";

function script() {
  return {
    scene: "咖啡馆", theme: "点单", level: "beginner",
    script: [
      { id: 1, type: "npc", character: "服务员", text: "¡Hola!", startTime: 0, endTime: 1 },
      { id: 2, type: "player", character: "白狗", text: "Un café, por favor.", translation: "请给我一杯咖啡。", startTime: 2, endTime: 4 },
      { id: 3, type: "player", character: "黄狗", text: "Un té, gracias.", startTime: 5, endTime: 8 },
    ] as Record<string, unknown>[],
  };
}

describe("saved script role plan", () => {
  it("maps only explicit legacy dog labels, keeping the saved sequence and text", async () => {
    const original = script();
    const plan = await createDubbingPlan(original);
    expect(plan).toMatchObject({ planVersion: 1, locale: "es-ES" });
    expect(plan.lines).toEqual([
      { lineId: "line-1", ordinal: 0, speakerKey: "npc:legacy-1", dubbable: false, text: "¡Hola!", voicePreset: "npc" },
      { lineId: "line-2", ordinal: 1, speakerKey: "white_dog", dubbable: true, text: "Un café, por favor.", translation: "请给我一杯咖啡。", voicePreset: "white_dog" },
      { lineId: "line-3", ordinal: 2, speakerKey: "yellow_dog", dubbable: true, text: "Un té, gracias.", voicePreset: "yellow_dog" },
    ]);
    expect(original.script[0]).not.toHaveProperty("speakerKey");
    expect(plan.scriptDigest).toMatch(/^[a-f0-9]{64}$/);
  });

  it("preserves explicit roles and reserves NPC IDs before mapping older NPCs", () => {
    const saved = script();
    saved.script.push({ id: 4, type: "npc", character: "顾客", speakerKey: "npc:legacy-1", dubbable: false, text: "Gracias." });
    saved.script.push({ id: 5, type: "npc", character: "服务员", text: "De nada." });
    const plan = parseDubbingScript(saved);
    expect(plan.lines.map((line) => line.speakerKey)).toEqual([
      "npc:legacy-2", "white_dog", "yellow_dog", "npc:legacy-1", "npc:legacy-2",
    ]);
  });

  it("does not infer a dog from nicknames, gender or a player flag", () => {
    for (const character of ["小白", "小鸡毛", "男生", "玩家 1", "__proto__", "constructor"]) {
      const saved = script();
      saved.script[1].character = character;
      expect(() => parseDubbingScript(saved)).toThrowError(expect.objectContaining({
        code: "ROLE_CONFIRMATION_REQUIRED", lineId: "line-2",
      }));
    }
  });

  it("accepts a model-assigned explicit key without deriving it from a display name", () => {
    const saved = script();
    saved.script[1] = { ...saved.script[1], character: "旅客", speakerKey: "white_dog", dubbable: true };
    expect(parseDubbingScript(saved).lines[1].speakerKey).toBe("white_dog");
  });

  it.each([
    ["speakerKey", "yellow_dog"], ["type", "npc"], ["dubbable", false], ["dubbable", "true"],
  ])("rejects conflicting %s metadata", (key, value) => {
    const saved = script();
    saved.script[1][key] = value;
    expect(() => parseDubbingScript(saved)).toThrowError(expect.objectContaining({ code: "ROLE_CONFLICT" }));
  });

  it.each(["npc:../waiter", "npc:", "npc:UPPER", "admin", null, "npc:" + "a".repeat(33)])("rejects unsafe speaker keys %s", (speakerKey) => {
    const saved = script();
    saved.script[0].speakerKey = speakerKey;
    expect(() => parseDubbingScript(saved)).toThrowError(expect.objectContaining({ code: "ROLE_CONFIRMATION_REQUIRED" }));
  });

  it("rejects NPC identity collisions instead of combining their voices", () => {
    const saved = script();
    saved.script[0].speakerKey = "npc:waiter";
    saved.script.push({ ...saved.script[0], id: 4, character: "路人" });
    expect(() => parseDubbingScript(saved)).toThrowError(expect.objectContaining({ code: "ROLE_CONFLICT" }));
  });

  it.each([-1, 1.1, Infinity, NaN, "2", Number.MAX_SAFE_INTEGER + 1])("rejects unsafe numeric line ID %s", (id) => {
    const saved = script();
    saved.script[1].id = id;
    expect(() => parseDubbingScript(saved)).toThrowError(expect.objectContaining({ code: "INVALID_LINE_ID" }));
  });

  it("rejects duplicate IDs and missing dog roles", () => {
    const saved = script();
    saved.script[1].id = 1;
    expect(() => parseDubbingScript(saved)).toThrowError(expect.objectContaining({ code: "DUPLICATE_LINE_ID" }));
    saved.script.shift();
    saved.script.pop();
    expect(() => parseDubbingScript(saved)).toThrowError(expect.objectContaining({ code: "MISSING_DOG_ROLE" }));
  });

  it.each(["", " ", "a".repeat(181), "Hola\u0000"]) ("rejects invalid or overly long text", (value) => {
    const saved = script();
    saved.script[2].text = value;
    expect(() => parseDubbingScript(saved)).toThrowError(expect.objectContaining({ code: "INVALID_TEXT" }));
  });

  it("bounds total source text even when each line is short", () => {
    const saved = script();
    saved.script = Array.from({ length: 8 }, (_, index) => ({
      ...saved.script[index % 2 + 1], id: index, text: "a".repeat(160),
    }));
    expect(() => parseDubbingScript(saved)).toThrowError(expect.objectContaining({ code: "SCRIPT_TOO_LONG" }));
    saved.script = Array.from({ length: 13 }, (_, index) => ({ ...saved.script[0], id: index, text: "Hola" }));
    expect(() => parseDubbingScript(saved)).toThrowError(expect.objectContaining({ code: "SCRIPT_TOO_LONG" }));
  });

  it("returns an actionable typed error without echoing private source text", () => {
    const privateText = "private-value".repeat(30);
    const saved = script();
    saved.script[1].text = privateText;
    try {
      parseDubbingScript(saved);
      expect.fail("invalid script should not parse");
    } catch (error) {
      expect(error).toBeInstanceOf(DubbingPlanError);
      expect((error as Error).message).not.toContain("private-value");
    }
  });

  it("hashes canonical content consistently, and changes the digest when a role or line changes", async () => {
    const original = script();
    const first = await createDubbingPlan(original);
    const reorderedKeys = { script: original.script, theme: original.theme, scene: original.scene };
    expect((await createDubbingPlan(reorderedKeys)).scriptDigest).toBe(first.scriptDigest);
    original.script[1].text = "Un té, por favor.";
    expect((await createDubbingPlan(original)).scriptDigest).not.toBe(first.scriptDigest);
    const changedRoles = script();
    changedRoles.script[1].character = "黄狗";
    changedRoles.script[2].character = "白狗";
    expect((await createDubbingPlan(changedRoles)).scriptDigest).not.toBe(first.scriptDigest);
    expect(await dubbingDigest("café 白狗")).toBe(createHash("sha256").update("café 白狗").digest("hex"));
  });
});
