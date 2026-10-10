"use client";

import { useReducer, useState } from 'react';
import { Button } from '@/components/ui/button';
import { createPracticeSession, practiceCards, practiceReducer, practiceRoles, type PracticeCard } from '@/lib/pipeline/rehearsalPractice';
import type { LessonScript } from '@/lib/pipeline/types';

function PracticeRound({ cards }: { cards: PracticeCard[] }) {
  const [state, dispatch] = useReducer(practiceReducer, cards, createPracticeSession);
  const card = state.cards[state.index];
  if (!card) return <p>这个角色暂无可练习台词。</p>;
  if (state.completed) return (
    <section className="space-y-3" aria-live="polite">
      <p>第 {state.round} 轮完成：{state.cards.length - state.review.length}/{state.cards.length} 句自评已掌握。</p>
      {state.review.length ? <Button onClick={() => dispatch({ type: 'review' })}>只复习待练台词（{state.review.length}）</Button>
        : <p>本轮全部掌握！可以换一个角色继续。</p>}
      <p className="text-sm text-muted-foreground">进度仅保留在本次打开的练习中；自评不代表自动语言评分。</p>
    </section>
  );
  return (
    <section className="space-y-4" aria-label="分角色台词练习">
      <p role="status">第 {state.round} 轮 · {state.index + 1}/{state.cards.length} 句 · {card.character}</p>
      <progress aria-label="本轮进度" value={state.index} max={state.cards.length} className="w-full" />
      {card.cue ? <div className="rounded border p-3"><p className="text-sm text-muted-foreground">上一句提示</p><p lang="es">{card.cue}</p></div> : null}
      <div className="rounded border p-3">
        <p className="text-sm text-muted-foreground">请先用西语说出你的台词</p>
        <p>{card.prompt ?? '这句没有中文翻译，请根据场景回忆，或查看答案后跟读。'}</p>
      </div>
      {state.revealed ? <p lang="es" className="text-lg font-semibold" aria-live="polite">{card.answer}</p>
        : <Button onClick={() => dispatch({ type: 'reveal' })}>显示西语答案</Button>}
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" disabled={!state.revealed} onClick={() => dispatch({ type: 'grade', remembered: false })}>还需练习</Button>
        <Button disabled={!state.revealed} onClick={() => dispatch({ type: 'grade', remembered: true })}>已掌握，下一句</Button>
      </div>
    </section>
  );
}

export function RehearsalPractice({ script }: { script: LessonScript }) {
  const roles = practiceRoles(script);
  const [role, setRole] = useState(roles[0] ?? '');
  const [restart, setRestart] = useState(0);
  if (!roles.length) return <p>暂无可练习台词。</p>;
  return (
    <div className="space-y-4">
      <label className="flex items-center gap-2">练习角色
        <select className="rounded border bg-background p-2" value={role} onChange={(event) => setRole(event.target.value)}>
          {roles.map((name) => <option key={name} value={name}>{name}</option>)}
        </select>
      </label>
      <p className="text-sm text-muted-foreground">看提示回忆台词，揭晓后自评。切换角色或关闭弹窗会重置练习。</p>
      <PracticeRound key={`${role}:${restart}`} cards={practiceCards(script, role)} />
      <Button variant="ghost" onClick={() => setRestart((value) => value + 1)}>重新练习此角色</Button>
    </div>
  );
}
