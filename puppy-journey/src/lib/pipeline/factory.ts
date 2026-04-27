/**
 * 工厂门面：主业务只通过此处暴露的方法调用 AI，便于替换底层模型实现。
 * 命名与需求中的 generate_script / 视频任务语义对齐。
 */

import type { GenerateScriptInput } from "@/lib/pipeline/adapters/scriptGenerator";
import type { LessonScript, PipelineVideoJobResult, StartVideoInput } from "@/lib/pipeline/types";
import {
  enqueueLessonVideo,
  generateLessonKeyVisual,
  generateLessonScript,
  pollLessonVideoJob,
} from "@/lib/pipeline/service";

export async function generate_script(input: GenerateScriptInput): Promise<LessonScript> {
  return generateLessonScript(input);
}

/** Agent 2：剧本 → 火山生图 */
export async function generate_key_image(script: LessonScript): Promise<{ imageUrl: string }> {
  return generateLessonKeyVisual(script);
}

/** Agent 3：提交异步视频任务，返回 jobId（前端轮询 get_video_job_status） */
export async function start_video_job(input: StartVideoInput): Promise<{ jobId: string }> {
  return enqueueLessonVideo(input);
}

export async function get_video_job_status(jobId: string): Promise<PipelineVideoJobResult> {
  return pollLessonVideoJob(jobId);
}
