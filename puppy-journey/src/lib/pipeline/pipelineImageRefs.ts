import fs from "node:fs";
import path from "node:path";

const WHITE = "white.png";
const YELLOW = "yellow.png";

/**
 * 读取 public/pipeline 下白狗/黄狗参考图，转为 data URL 供火山多图生图。
 */
export function loadPipelineDogRefDataUrls(): { white: string; yellow: string } {
  const root = process.cwd();
  const whitePath = path.join(root, "public", "pipeline", WHITE);
  const yellowPath = path.join(root, "public", "pipeline", YELLOW);
  if (!fs.existsSync(whitePath)) {
    throw new Error(`Agent 2 缺少垫图：请将 ${WHITE} 置于 public/pipeline/`);
  }
  if (!fs.existsSync(yellowPath)) {
    throw new Error(`Agent 2 缺少垫图：请将 ${YELLOW} 置于 public/pipeline/`);
  }
  const wb = fs.readFileSync(whitePath);
  const yb = fs.readFileSync(yellowPath);
  return {
    white: `data:image/png;base64,${wb.toString("base64")}`,
    yellow: `data:image/png;base64,${yb.toString("base64")}`,
  };
}
