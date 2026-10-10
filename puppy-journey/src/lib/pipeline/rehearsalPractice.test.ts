import { describe, expect, it } from 'vitest';
import { createPracticeSession, practiceCards, practiceReducer, practiceRoles } from './rehearsalPractice';
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
});
