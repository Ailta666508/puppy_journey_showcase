import { expect, it } from 'vitest';
import { rehearsalTranscript, transcriptLines } from './rehearsalTranscript';
import type { LessonScript } from './types';
const script: LessonScript = {scene:'咖啡馆',theme:'点单',level:'beginner',script:[
 {id:1,type:'player',character:'你',text:'Un café, por favor.',translation:'请给我一杯咖啡。',startTime:0,endTime:3},
 {id:2,type:'npc',character:'服务员',text:'Claro.',startTime:3,endTime:5},
]};
it('exports ordered bilingual dialogue without requiring video or external URLs', () => {
 expect(rehearsalTranscript(script)).toBe('点单 · 咖啡馆\nLevel: beginner\n\n你 (你): Un café, por favor.\n请给我一杯咖啡。\n\n服务员 (对方): Claro.\n');
});
it('skips malformed saved lines and non-string translations', () => {
 const saved = {...script,script:[null,{}, {...script.script[0],translation:42},...script.script]} as unknown as LessonScript;
 expect(transcriptLines(saved)).toHaveLength(3);
 expect(rehearsalTranscript(saved)).not.toContain('42');
});
it('preserves literal text rather than interpreting HTML', () => {
 expect(rehearsalTranscript({...script,script:[{...script.script[0],text:'<script>example</script>'}]})).toContain('<script>example</script>');
});
