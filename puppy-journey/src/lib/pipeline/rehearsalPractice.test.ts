import { describe, expect, it } from 'vitest';
import { createPracticeSession, loadPersistedPracticeSession, practiceCards, practiceReducer, practiceRoles, practiceSessionStorageKey, restorePracticeSession } from './rehearsalPractice';
import type { LessonScript } from './types';

const script = {
  theme: 'Synthetic cafe', scene: 'Cafe', level: 'beginner', script: [
    { id: 'same', type: 'npc', character: 'Waiter', text: '¿Qué quieres?', translation: '你想要什么？' },
    { id: 'same', type: 'player', character: 'Guest', text: 'Un café.', translation: '一杯咖啡。' },
    { id: 'same', type: 'player', character: 'Guest', text: 'Gracias.' },
    null,
    { character: 'Invalid', type: 'npc', text: 42 },
    { character: 'Empty', type: 'player', text: ' ' },
  ],
} as unknown as LessonScript;

describe('saved script role practice', () => {
  it('selects roles in dialogue order and keeps preceding context and duplicate IDs safe', () => {
    expect(practiceRoles(script)).toEqual(['Waiter', 'Guest']);
    const cards = practiceCards(script, 'Guest');
    expect(cards).toHaveLength(2);
    expect(cards[0]).toMatchObject({ key: 1, cue: 'Waiter: ¿Qué quieres?', prompt: '一杯咖啡。', answer: 'Un café.' });
    expect(cards[1]).toMatchObject({ key: 2, prompt: null, cue: 'Guest: Un café.' });
    expect(practiceCards(script, 'missing')).toEqual([]);
  });
  it('cannot grade an unseen answer and resets disclosure on each turn', () => {
    const state = createPracticeSession(practiceCards(script, 'Guest'));
    expect(practiceReducer(state, { type: 'grade', remembered: true })).toBe(state);
    const next = practiceReducer(practiceReducer(state, { type: 'reveal' }), { type: 'grade', remembered: true });
    expect(next).toMatchObject({ index: 1, revealed: false, completed: false, review: [] });
    expect(state.index).toBe(0);
  });
  it('completes a round, reviews only missed lines, and finishes without repeating mastered lines', () => {
    let state = createPracticeSession(practiceCards(script, 'Guest'));
    state = practiceReducer(practiceReducer(state, { type: 'reveal' }), { type: 'grade', remembered: false });
    state = practiceReducer(practiceReducer(state, { type: 'reveal' }), { type: 'grade', remembered: true });
    expect(state.completed).toBe(true);
    expect(state.review.map((card) => card.answer)).toEqual(['Un café.']);
    expect(practiceReducer(state, { type: 'grade', remembered: false })).toBe(state);
    state = practiceReducer(state, { type: 'review' });
    expect(state).toMatchObject({ round: 2, index: 0, revealed: false, completed: false, review: [] });
    expect(state.cards).toHaveLength(1);
    state = practiceReducer(practiceReducer(state, { type: 'reveal' }), { type: 'grade', remembered: true });
    expect(state).toMatchObject({ completed: true, review: [] });
    expect(practiceReducer(state, { type: 'review' })).toBe(state);
  });
  it('handles empty scripts and ignores review before the round ends', () => {
    const empty = createPracticeSession([]);
    expect(empty.completed).toBe(true);
    expect(practiceReducer(empty, { type: 'reveal' })).toBe(empty);
    const state = createPracticeSession(practiceCards(script, 'Guest'));
    expect(practiceReducer(state, { type: 'review' })).toBe(state);
  });

  it('restores only an exact script session and drops malformed or stale saved progress', () => {
    const cards = practiceCards(script, 'Guest');
    const state = practiceReducer(practiceReducer(createPracticeSession(cards), { type: 'reveal' }), { type: 'grade', remembered: false });
    expect(restorePracticeSession(cards, JSON.stringify(state))).toMatchObject({ index: 1, review: [cards[0]] });
    expect(restorePracticeSession(cards, '{bad json')).toEqual(createPracticeSession(cards));
    expect(restorePracticeSession([{ ...cards[0], answer: 'edited' }, ...cards.slice(1)], JSON.stringify(state))).toEqual(createPracticeSession([{ ...cards[0], answer: 'edited' }, ...cards.slice(1)]));
    expect(practiceSessionStorageKey(cards, 'Guest')).not.toBe(practiceSessionStorageKey(cards, 'Waiter'));
  });

  it('falls back to a fresh session when browser storage is unavailable', () => {
    const cards = practiceCards(script, 'Guest');
    expect(loadPersistedPracticeSession(cards, 'blocked')).toEqual(createPracticeSession(cards));
  });

  it('expires old persisted progress while accepting the legacy session format', () => {
    const cards = practiceCards(script, 'Guest');
    const state = practiceReducer(createPracticeSession(cards), { type: 'reveal' });
    expect(restorePracticeSession(cards, JSON.stringify(state), 1_000).revealed).toBe(true);
    const expired = JSON.stringify({ version: 1, savedAt: 1_000, state });
    expect(restorePracticeSession(cards, expired, 1_000 + 31 * 24 * 60 * 60 * 1000)).toEqual(createPracticeSession(cards));
    const current = JSON.stringify({ version: 1, savedAt: 1_000, state });
    expect(restorePracticeSession(cards, current, 2_000).revealed).toBe(true);
  });
});
