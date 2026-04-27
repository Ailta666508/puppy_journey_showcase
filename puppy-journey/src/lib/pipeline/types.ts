/**
 * 西语学习管线类型（剧本 → 图 → 视频）。
 */

export type ScriptLine = {
  id: number;
  type: "npc" | "player";
  character: string;
  text: string;
  translation?: string;
  startTime: number;
  endTime: number;
};

/** Agent 1（合并感知+融合）产出的结构化剧本 */
export type LessonScript = {
  scene: string;
  theme: string;
  level: "beginner" | "intermediate" | "advanced";
  script: ScriptLine[];
  /** 供生图模型用的简短视觉描述（模型可填） */
  visualPromptHint?: string;
};

export type PipelineJobStatus = "queued" | "processing" | "completed" | "failed";

export type PipelineVideoJobResult = {
  status: PipelineJobStatus;
  videoUrl?: string;
  thumbnailUrl?: string;
  error?: string;
  /** 第三方任务 ID（调试用） */
  providerTaskId?: string;
};

export type StartVideoInput = {
  script: LessonScript;
  /**
   * 传入则走图生视频（优先使用旅行日记真实配图）；
   * 省略或空字符串时走纯文本 Prompt 的文生视频（Text-to-Video）降级。
   */
  firstFrameImageUrl?: string;
};
