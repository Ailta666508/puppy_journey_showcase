/**
 * 业务门面：前端与其它模块只依赖本文件导出的方法，不直接依赖具体模型 SDK。
 */

import { generateImageFromScript } from "@/lib/pipeline/adapters/imageFromScript";
import { generateScript, type GenerateScriptInput } from "@/lib/pipeline/adapters/scriptGenerator";
import { getVideoJobStatus, startVideoGeneration } from "@/lib/pipeline/adapters/videoGeneration";
import type { LessonScript, PipelineVideoJobResult, StartVideoInput } from "@/lib/pipeline/types";

export type { GenerateScriptInput, LessonScript, PipelineVideoJobResult, StartVideoInput };

export async function generateLessonScript(input: GenerateScriptInput) {
  return generateScript(input);
}

export async function generateLessonKeyVisual(script: LessonScript) {
  return generateImageFromScript(script);
}

export async function enqueueLessonVideo(input: StartVideoInput) {
  return startVideoGeneration(input);
}

export async function pollLessonVideoJob(jobId: string): Promise<PipelineVideoJobResult> {
  return getVideoJobStatus(jobId);
}
