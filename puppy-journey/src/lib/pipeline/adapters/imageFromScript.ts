import { buildAgent2ImagePrompt } from "@/lib/pipeline/prompts";
import { loadPipelineDogRefDataUrls } from "@/lib/pipeline/pipelineImageRefs";
import type { LessonScript } from "@/lib/pipeline/types";
import { generateVolcImageWithImages } from "@/lib/volcengineImageGen";

/**
 * Agent 2：根据剧本 scene + white.png / yellow.png 垫图调用火山多图生图。
 */
export async function generateImageFromScript(script: LessonScript): Promise<{ imageUrl: string }> {
  const refs = loadPipelineDogRefDataUrls();
  const prompt = buildAgent2ImagePrompt(script.scene, script.theme);
  const images = [refs.white, refs.yellow];

  const { url, b64Json } = await generateVolcImageWithImages(prompt, {
    images,
    size: "2K",
    responseFormat: "url",
  });

  if (url?.trim()) {
    return { imageUrl: url.trim() };
  }
  if (b64Json?.trim()) {
    return { imageUrl: `data:image/png;base64,${b64Json.trim()}` };
  }
  throw new Error("Agent 2 生图未返回 URL 或 base64");
}
