export const runtime = "nodejs";

import fs from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";

import {
  getQAvatarVolcengineCredentials,
  Q_AVATAR_ENV_HINT,
} from "@/lib/qAvatarVolcengineConfig";
import { generateVolcImageWithImages } from "@/lib/volcengineImageGen";

/** 允许读取的风格参考图扩展名（小写） */
const ALLOWED_IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif"]);

/** 风格参考图目录（相对项目根目录） */
const STYLE_REFS_DIR = "style_refs";

type GenerateRequestBody = {
  imageBase64: string; // supports raw base64 or data URL
  prompt?: string;
};

function normalizeBase64(input: string) {
  const s = input.trim();
  if (!s) return "";
  if (s.startsWith("data:")) return s;
  return `data:image/png;base64,${s}`;
}

/**
 * 递归收集目录及其子目录下的所有图片文件路径（仅一层子目录，与 style_refs/01_xxx.png/re.png 结构兼容）。
 */
function collectImagePaths(dir: string, baseDir: string, list: { fullPath: string; name: string }[]): void {
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) return;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const e of entries) {
    const fullPath = path.join(dir, e.name);
    if (e.isFile() && ALLOWED_IMAGE_EXTENSIONS.has(path.extname(e.name).toLowerCase())) {
      list.push({ fullPath, name: e.name });
    } else if (e.isDirectory() && path.relative(baseDir, dir) === "") {
      collectImagePaths(fullPath, baseDir, list);
    }
  }
}

/** 返回 style_refs 下收集到的图片相对路径列表（用于调试与 GET 校验）。 */
function getStyleRefPaths(): string[] {
  const baseDir = path.join(process.cwd(), STYLE_REFS_DIR);
  const list: { fullPath: string; name: string }[] = [];
  collectImagePaths(baseDir, baseDir, list);
  list.sort((a, b) => a.fullPath.localeCompare(b.fullPath, "en"));
  return list.map(({ fullPath }) => path.relative(process.cwd(), fullPath));
}

/**
 * 从 style_refs/ 读取所有图片（含子文件夹），按路径排序后转为 Base64 数组。
 */
function getStyleRefsBase64(): string[] {
  const baseDir = path.join(process.cwd(), STYLE_REFS_DIR);
  const list: { fullPath: string; name: string }[] = [];
  collectImagePaths(baseDir, baseDir, list);
  list.sort((a, b) => a.fullPath.localeCompare(b.fullPath, "en"));

  const result: string[] = [];
  for (const { fullPath, name } of list) {
    try {
      const buf = fs.readFileSync(fullPath);
      const ext = path.extname(name).toLowerCase();
      const mime = ext === ".png" ? "image/png" : ext === ".jpg" || ext === ".jpeg" ? "image/jpeg" : ext === ".webp" ? "image/webp" : "image/gif";
      result.push(`data:${mime};base64,${buf.toString("base64")}`);
    } catch {
      // 单文件失败跳过
    }
  }
  return result;
}

/** 多图垫图时的固定 prompt（第一张=真人，其余=画风/结构参考） */
const MULTI_IMAGE_PROMPT = `我传入了一组图片。第一张图是真人照片，其余图片是画风与成图参考。

【小狗头部与身体必须与垫图一致】
- 小狗的头部造型、五官画法、耳朵形状与大小，必须与图4（白狗）、图5（黄狗）完全一致，不得自行发挥。
- 头身比、身体比例、四肢粗细与长度必须严格复刻图4/图5，与参考图保持一致。
- 线条风格：极简黑色粗线条、圆润造型、波浪轮廓线、纯白/黄色填充，全部以图4、图5为准。

【成图质量不低于图6】
- 最终成图的整体效果、构图、清晰度、线条完成度、细节丰富度必须以图6（04_example）为最低标准，不得低于图6的质量。
- 小狗在画面中的比例、与背景的融合度、光影与透视，以图6为唯一参考标准。

将第一张图中的人物重绘为一只Q版小狗：男生用黄色小狗（与图5一致），女生用白色小狗（与图4一致）。严格保留原图人物的动作和手持物品。

具体规则：图3为肢体结构参考（直立或四肢着地）；图4、图5为小狗头与身体的唯一造型参考，精准复刻用户上传的肢体动作与姿态（手臂角度、手部、身体朝向、头部角度）。配件（手机、花枝、书本等）风格与小狗线条一致。画面比例与用户图一致（竖版 9:16 或 1:1），小狗自然融入原场景，光影透视匹配。
示例：用户上传为图2，豆包出图为图1。`;

/** GET：校验 style_refs 是否被正确读取，返回找到的图片相对路径与数量。 */
export async function GET() {
  const paths = getStyleRefPaths();
  return NextResponse.json({
    ok: true,
    styleRefs: { count: paths.length, paths },
  });
}

export async function POST(req: Request) {
  try {
    const { imageBase64, prompt }: GenerateRequestBody = await req.json();

    if (!getQAvatarVolcengineCredentials()) {
      return NextResponse.json(
        { ok: false, error: Q_AVATAR_ENV_HINT },
        { status: 503 },
      );
    }

    const userImage = normalizeBase64(imageBase64 || "");
    if (!userImage) {
      return NextResponse.json({ ok: false, error: "Missing imageBase64" }, { status: 400 });
    }

    const styleRefs = getStyleRefsBase64();
    const imageArray: string[] = [userImage, ...styleRefs];

    const finalPrompt = prompt?.trim() || MULTI_IMAGE_PROMPT;

    let b64: string | undefined;
    let url: string | undefined;
    try {
      const out = await generateVolcImageWithImages(finalPrompt, {
        images: imageArray,
        responseFormat: "b64_json",
        size: "2K",
      });
      b64 = out.b64Json;
      url = out.url;
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return NextResponse.json(
        { ok: false, error: "Volcengine image generation failed", details: message },
        { status: 502 },
      );
    }

    if (!b64 && !url) {
      return NextResponse.json(
        { ok: false, error: "No image returned from model" },
        { status: 502 },
      );
    }

    return NextResponse.json({
      ok: true,
      b64,
      url,
      debug: { styleRefsCount: styleRefs.length, imageArrayLength: imageArray.length, styleRefPaths: getStyleRefPaths() },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

