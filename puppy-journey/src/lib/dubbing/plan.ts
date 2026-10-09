import {
  DUBBING_LIMITS,
  DubbingPlanError,
  type DogSpeakerKey,
  type DubbingPlan,
  type DubbingPlanLine,
  type DubbingSpeakerKey,
} from "./contracts";

const DOG_ALIASES: Readonly<Record<string, DogSpeakerKey>> = {
  白狗: "white_dog",
  小白狗: "white_dog",
  白色小狗: "white_dog",
  黄狗: "yellow_dog",
  小黄狗: "yellow_dog",
  黄色小狗: "yellow_dog",
};
const NPC_KEY = /^npc:[a-z][a-z0-9_-]{0,31}$/;
const CONTROL_CHARACTERS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;

export function isDubbingSpeakerKey(value: unknown): value is DubbingSpeakerKey {
  return typeof value === "string" && (
    value === "yellow_dog" || value === "white_dog" || NPC_KEY.test(value)
  );
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function text(value: unknown, max: number, lineId?: string): string {
  if (typeof value !== "string" || !value.trim() || value.length > max || CONTROL_CHARACTERS.test(value)) {
    throw new DubbingPlanError("INVALID_TEXT", "台词或角色信息不完整、过长或包含无效字符，请重新确认剧本。", lineId);
  }
  return value.trim();
}

/** Resolve only explicit dog labels; a nickname or player/npc flag never identifies a dog. */
export function parseDubbingScript(script: unknown): {
  scene: string;
  theme: string;
  lines: DubbingPlanLine[];
} {
  if (!record(script) || !Array.isArray(script.script) || script.script.length === 0) {
    throw new DubbingPlanError("INVALID_SCRIPT", "没有可用于配音的已保存剧本，请先生成剧本。");
  }
  if (script.script.length > DUBBING_LIMITS.maxLines) {
    throw new DubbingPlanError("SCRIPT_TOO_LONG", "配音方案最多支持 12 句台词，请缩短剧本。");
  }
  const scene = text(script.scene, 300);
  const theme = text(script.theme, 300);
  const ids = new Set<string>();
  const npcKeys = new Map<string, DubbingSpeakerKey>();
  const usedNpcKeys = new Map<DubbingSpeakerKey, string>();
  let totalCharacters = 0;

  // Reserve explicit keys before assigning IDs to legacy NPCs, avoiding collisions.
  for (const raw of script.script) {
    if (record(raw) && isDubbingSpeakerKey(raw.speakerKey) && raw.speakerKey.startsWith("npc:") && typeof raw.character === "string") {
      const name = raw.character.trim();
      const existing = npcKeys.get(name);
      const existingName = usedNpcKeys.get(raw.speakerKey);
      if ((existing && existing !== raw.speakerKey) || (existingName && existingName !== name)) {
        throw new DubbingPlanError("ROLE_CONFLICT", "同一个 NPC 的角色编号不一致，请确认角色后再配音。");
      }
      npcKeys.set(name, raw.speakerKey);
      usedNpcKeys.set(raw.speakerKey, name);
    }
  }

  const lines = script.script.map((raw: unknown, ordinal): DubbingPlanLine => {
    if (!record(raw)) throw new DubbingPlanError("INVALID_SCRIPT", "剧本包含无效台词，请重新确认剧本。");
    if (typeof raw.id !== "number" || !Number.isSafeInteger(raw.id) || raw.id < 0) {
      throw new DubbingPlanError("INVALID_LINE_ID", "台词缺少稳定的句子编号，请重新生成剧本。");
    }
    const lineId = `line-${raw.id}`;
    if (ids.has(lineId)) throw new DubbingPlanError("DUPLICATE_LINE_ID", "剧本存在重复句子编号，请重新生成剧本。", lineId);
    ids.add(lineId);
    const character = text(raw.character, 80, lineId);
    const alias = Object.hasOwn(DOG_ALIASES, character) ? DOG_ALIASES[character] : undefined;
    let speakerKey: DubbingSpeakerKey;
    if (raw.speakerKey !== undefined) {
      if (!isDubbingSpeakerKey(raw.speakerKey)) {
        throw new DubbingPlanError("ROLE_CONFIRMATION_REQUIRED", "这句台词没有明确角色，请确认由黄狗、白狗还是 NPC 说。", lineId);
      }
      speakerKey = raw.speakerKey;
      if (alias && alias !== speakerKey) {
        throw new DubbingPlanError("ROLE_CONFLICT", "角色名称与配音角色不一致，请先确认分工。", lineId);
      }
    } else if (alias) {
      speakerKey = alias;
    } else if (raw.type === "npc") {
      const existing = npcKeys.get(character);
      if (existing) speakerKey = existing;
      else {
        let index = 1;
        while (usedNpcKeys.has(`npc:legacy-${index}`)) index++;
        speakerKey = `npc:legacy-${index}`;
        npcKeys.set(character, speakerKey);
        usedNpcKeys.set(speakerKey, character);
      }
    } else {
      throw new DubbingPlanError("ROLE_CONFIRMATION_REQUIRED", "这句台词的角色不明确，请使用黄狗或白狗的明确分工。", lineId);
    }
    const dubbable = speakerKey === "white_dog" || speakerKey === "yellow_dog";
    if (raw.type !== (dubbable ? "player" : "npc") || (raw.dubbable !== undefined && raw.dubbable !== dubbable)) {
      throw new DubbingPlanError("ROLE_CONFLICT", "台词类型或可配音标记与角色冲突，请先确认角色分工。", lineId);
    }
    const lineText = text(raw.text, DUBBING_LIMITS.maxLineCharacters, lineId);
    totalCharacters += lineText.length;
    const translation = raw.translation === undefined ? undefined : text(raw.translation, DUBBING_LIMITS.maxTranslationCharacters, lineId);
    return {
      lineId, ordinal, speakerKey, dubbable, text: lineText,
      ...(translation === undefined ? {} : { translation }),
      voicePreset: dubbable ? speakerKey as DogSpeakerKey : "npc",
    };
  });
  if (totalCharacters > DUBBING_LIMITS.maxTotalCharacters) {
    throw new DubbingPlanError("SCRIPT_TOO_LONG", "台词总长度超过配音上限，请缩短剧本。");
  }
  if (!["white_dog", "yellow_dog"].every((role) => lines.some((line) => line.speakerKey === role && line.dubbable))) {
    throw new DubbingPlanError("MISSING_DOG_ROLE", "黄狗和白狗需要各有至少一句完整台词，请先补全角色分工。");
  }
  return { scene, theme, lines };
}

/** Web Crypto keeps shared plan code free of Node-only imports. */
export async function dubbingDigest(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function createDubbingPlan(script: unknown): Promise<DubbingPlan> {
  const parsed = parseDubbingScript(script);
  const canonical = { planVersion: 1, locale: "es-ES", scene: parsed.scene, theme: parsed.theme, lines: parsed.lines };
  return {
    planVersion: 1,
    locale: "es-ES",
    scriptDigest: await dubbingDigest(JSON.stringify(canonical)),
    lines: parsed.lines,
  };
}
