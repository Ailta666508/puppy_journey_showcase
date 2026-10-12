import { transcriptLines } from './rehearsalTranscript';
import type { LessonScript } from './types';

export type PracticeCard = {
  key: number;
  character: string;
  cue: string | null;
  prompt: string | null;
  answer: string;
};
export type PracticeSession = {
  cards: PracticeCard[];
  index: number;
  revealed: boolean;
  review: PracticeCard[];
  completed: boolean;
  round: number;
};

/** Use line positions as keys: provider line IDs may be missing or duplicated. */
export function practiceCards(script: LessonScript, character: string): PracticeCard[] {
  const lines = transcriptLines(script).filter((line) => line.text.trim());
  return lines.flatMap((line, index) => line.character === character ? [{
    key: index,
    character: line.character,
    cue: index > 0 ? `${lines[index - 1].character}: ${lines[index - 1].text}` : null,
    prompt: typeof line.translation === 'string' && line.translation.trim() ? line.translation : null,
    answer: line.text,
  }] : []);
}

export function practiceRoles(script: LessonScript): string[] {
  return [...new Set(transcriptLines(script).filter((line) => line.text.trim()).map((line) => line.character))];
}

export function createPracticeSession(cards: PracticeCard[], round = 1): PracticeSession {
  return { cards, index: 0, revealed: false, review: [], completed: cards.length === 0, round };
}

/** Stable, content-scoped key: never restore progress onto an edited script. */
export function practiceSessionStorageKey(cards: PracticeCard[], role: string): string {
  const identity = cards.map((card) => `${card.key}:${card.answer}`).join('|');
  let hash = 5381;
  for (const character of `${role}|${identity}`) hash = ((hash * 33) ^ character.charCodeAt(0)) >>> 0;
  return `puppy-journey:rehearsal-practice:v1:${hash.toString(36)}`;
}

export function restorePracticeSession(cards: PracticeCard[], raw: string | null): PracticeSession {
  if (!raw) return createPracticeSession(cards);
  try {
    const saved = JSON.parse(raw) as Partial<PracticeSession>;
    const index = saved.index;
    const round = saved.round;
    if (!Array.isArray(saved.cards) || saved.cards.length !== cards.length ||
      saved.cards.some((card, index) => card?.key !== cards[index]?.key || card?.answer !== cards[index]?.answer) ||
      !Number.isInteger(index) || index === undefined || index < 0 || index >= Math.max(cards.length, 1) ||
      !Number.isInteger(round) || round === undefined || round < 1 || !Array.isArray(saved.review)) return createPracticeSession(cards);
    const known = new Map(cards.map((card) => [card.key, card]));
    const review = saved.review.map((card) => known.get(card?.key)).filter((card): card is PracticeCard => Boolean(card));
    if (review.length !== saved.review.length || typeof saved.revealed !== 'boolean' || typeof saved.completed !== 'boolean') return createPracticeSession(cards);
    return { cards, index, revealed: saved.revealed, review, completed: saved.completed, round };
  } catch {
    return createPracticeSession(cards);
  }
}

export type PracticeAction = { type: 'reveal' } | { type: 'grade'; remembered: boolean } | { type: 'review' };
export function practiceReducer(state: PracticeSession, action: PracticeAction): PracticeSession {
  if (action.type === 'review') {
    return state.completed && state.review.length
      ? createPracticeSession(state.review, state.round + 1) : state;
  }
  if (state.completed) return state;
  if (action.type === 'reveal') return { ...state, revealed: true };
  // Rating unseen answers would turn progress into accidental clicks.
  if (!state.revealed) return state;
  const completed = state.index + 1 === state.cards.length;
  return {
    ...state,
    index: completed ? state.index : state.index + 1,
    completed,
    revealed: false,
    review: action.remembered ? state.review : [...state.review, state.cards[state.index]],
  };
}
