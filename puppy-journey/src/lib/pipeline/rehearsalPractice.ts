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
