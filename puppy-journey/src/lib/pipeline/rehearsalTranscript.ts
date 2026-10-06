import type { LessonScript, ScriptLine } from './types';

/** Saved/provider JSON is untrusted: discard malformed lines before rendering. */
export function transcriptLines(script: LessonScript): ScriptLine[] {
  return script.script.filter((line): line is ScriptLine => !!line &&
    typeof line === 'object' && typeof line.text === 'string' &&
    typeof line.character === 'string' && (line.type === 'npc' || line.type === 'player'));
}

export function rehearsalTranscript(script: LessonScript): string {
  const lines = [`${script.theme} · ${script.scene}`, `Level: ${script.level}`, ''];
  for (const line of transcriptLines(script)) {
    lines.push(`${line.character} (${line.type === 'player' ? '你' : '对方'}): ${line.text}`);
    if (typeof line.translation === 'string' && line.translation.trim()) lines.push(line.translation);
    lines.push('');
  }
  return lines.join('\n');
}
