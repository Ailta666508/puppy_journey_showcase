/**
 * Agent 1 / 2 / 3 提示词与输出规范（写死在代码中，换模型勿改字段语义时请同步此处）。
 */

/** Agent 1：合并解析 + 结构化剧本。上下文即「成就页 / 旅行页 / 心愿页」接口结果的摘要（由调用方传入）。 */
export const MERGED_SCRIPT_SYSTEM = `你是「Agent 1」西语学习管线编剧。

【输入来源（已由上游接口汇总进文本，你只需基于这些内容创作）】
1) 用户上传的文字信息 —— 结合【成就页、旅行页、心愿页】接口提供的业务上下文做意图与主题提炼。
2) 用户上传的图片或图片说明 —— 结合【旅行页】接口相关上下文，提取场景、物体与氛围（若消息中含多模态图片须优先看图）。

【输出要求】
- 只输出一个 JSON 对象，不要 Markdown 代码围栏，不要多余说明文字。
- 顶层字段必须包含：scene（字符串）、theme（字符串）、script（数组）。
- script 数组内每一项必须包含：id（数字）、type（仅 "npc" 或 "player"）、character（字符串）、text（西语台词）、translation（中文翻译）、startTime、endTime（数字，单位秒）。
- startTime/endTime 是「该句对白在成片里的大致起止时间」，须单调递增、互不重叠；**全片最后一行的 endTime 应接近 8.0**（与下游约 8 秒视频一致）。句与句之间至少留 **0.5～1.0 秒** 停顿。语速按**慢读、零基础能跟读**估算：短句单行时长一般 **不少于约 2.2 秒**，长句按词数加长，**不要为了塞满内容而把时间轴压得太紧**。
- NPC 与两只小狗（白狗、黄狗）对白清晰；player 行的 character 须明确写「白狗」或「黄狗」。
- 可选字段 level：beginner | intermediate | advanced，缺省视为 beginner。
- 可选字段 visualPromptHint：供后续生图的一句画面提示，可省略。

【结构示例（字段名与类型须一致；内容请根据本次输入原创，勿照抄示例台词）】`;

/** 与系统说明配套的 canonical JSON 示例（写死进提示，约束模型输出形状） */
export const SCRIPT_JSON_CANONICAL_EXAMPLE = `{
  "scene": "巴塞罗那的百年咖啡馆",
  "theme": "初级点单对话",
  "level": "beginner",
  "script": [
    {
      "id": 1,
      "type": "npc",
      "character": "服务员",
      "text": "¡Hola! ¿Qué van a tomar?",
      "translation": "你好！你们要喝点什么？",
      "startTime": 0.0,
      "endTime": 2.8
    },
    {
      "id": 2,
      "type": "player",
      "character": "白狗",
      "text": "Un café con leche, por favor.",
      "translation": "请给我一杯拿铁。",
      "startTime": 3.4,
      "endTime": 5.9
    },
    {
      "id": 3,
      "type": "player",
      "character": "黄狗",
      "text": "Y un cortado para mí, gracias.",
      "translation": "我要一杯可塔朵，谢谢。",
      "startTime": 6.5,
      "endTime": 8.0
    }
  ]
}`;

/** 无上传文件时可用于联调的默认「图片侧」文字说明（夜间户外烧烤） */
export const DEFAULT_PIPELINE_IMAGE_CONTEXT_ZH = `夜间户外烧烤：长方形烤炉、炭火通红，多串烤肉、大虾、彩椒肉串、鸡翅与土豆片，有人正在翻动烤串。`;

export function buildMergedScriptUserPrompt(input: {
  userText: string;
  imageDescription: string;
  contextAchievements: string;
  contextTravel: string;
  contextWishes: string;
}): string {
  return [
    `【用户文字】\n${input.userText || "（未提供）"}`,
    `【图片/场景说明】（与旅行页接口上下文一并理解）\n${input.imageDescription || "（未提供）"}`,
    `【成就页接口上下文摘要】\n${input.contextAchievements || "（未提供）"}`,
    `【旅行页接口上下文摘要】\n${input.contextTravel || "（未提供）"}`,
    `【心愿页接口上下文摘要】\n${input.contextWishes || "（未提供）"}`,
    "",
    "请严格按系统说明输出 JSON，结构必须与下列示例一致（字段名一致；内容根据本次输入生成）：",
    SCRIPT_JSON_CANONICAL_EXAMPLE,
  ].join("\n");
}

/**
 * Agent 2：垫图顺序与 public/pipeline/white.png、yellow.png 一致 —— 图1 白狗参考，图2 黄狗参考。
 * scene 必须使用剧本中的 scene 字段。
 */
export function buildAgent2ImagePrompt(scene: string, theme: string): string {
  const s = scene.trim() || "西语学习场景";
  const t = theme.trim() || "初级对话";
  return [
    "【Agent 2 固定规范】多图生图任务。",
    "图1 = white.png（白狗角色造型与配色参考）。",
    "图2 = yellow.png（黄狗角色造型与配色参考）。",
    `必须根据剧本 scene「${s}」与 theme「${t}」生成单张横版插画：同时呈现场景环境与两只小狗角色（白狗、黄狗），风格明亮、友好、卡通教育风；画面中不要出现任何文字、字幕或水印。`,
    "构图需能看出 NPC 与双狗可在该场景互动，适合作为视频首帧。",
  ].join("\n");
}

/** Agent 3：通用节奏与教学向（图生 / 文生共用） */
export const AGENT3_VIDEO_TASK_COMMON = [
  "【Agent 3 · 通用】生成约 8 秒钟、入门级的西班牙语学习视频，节奏适合零基础跟读。",
  "对白节奏须明显偏慢，句间有清晰停顿；画面可含与对白匹配的简单口型或教学感；不要求真实人声可由上游模型决定。",
].join("");

/**
 * Agent 3 · 图生视频：唯一画面基准 = 请求中附带的首帧图（即 Agent 2 根据 Agent 1 剧本产出的关键帧）。
 * 必须锁死卡通双狗形象，禁止画风漂移；叙事仅来自 Agent 1 JSON。
 */
export const AGENT3_IMAGE_TO_VIDEO_SOURCE_LOCK = [
  "【来源与一致性 · 必须严格遵守，不得省略】",
  "（A）首帧图唯一权威：请求中附带的首帧即本片的第 0 秒画面。在标准管线里该关键帧由「Agent 2」依据同一轮「Agent 1」JSON 剧本生成；无论首帧来自生图还是其它合规参考，全片视觉必须与该首帧逐帧连贯——同一场景、同一套色彩与光影、同一渲染风格，禁止整体换景或重绘成另一套美术。",
  "（B）角色锁死：首帧中出现的白狗与黄狗为固定卡通人设——粗黑轮廓线、扁平明亮填色、圆润 Q 版身体、教育向手账/矢量卡通感（与 white.png、yellow.png 品牌小狗一致）。全片禁止将其变成写实真狗、毛片级 CGI、真人扮装或其它物种；禁止改毛色主调（白狗以浅白/奶白为主、黄狗以暖黄/奶黄为主）、禁止换脸型或丢失粗描边风格。",
  "（C）动态幅度：仅允许小幅情绪与肢体、对白同步的简单口型、稳健推拉/平移/轻微镜头摆动；禁止「另起炉灶」式改人设、换装、换品种、换画风或引入首帧中不存在的第三套主角造型。",
  "（D）叙事与台词锁「Agent 1」JSON：下方给出的 scene、theme、每一行对白必须严格对应剧本中的角色（含 NPC / 白狗 / 黄狗）、西语原文与出场顺序；不得编造剧本未写明的角色、台词或情节分支。",
].join("");

/** Agent 3 · 文生视频：无 Agent 2 首帧时，仍须严格按 Agent 1 JSON 生成教育向卡通双狗场景 */
export const AGENT3_TEXT_TO_VIDEO_SCRIPT_LOCK = [
  "【文生视频 · 画风与剧本】无首帧图时，请根据下方 Agent 1 的 scene、theme 与对白，直接生成与教育管线一致的画面：同一粗描边、扁平卡通、白狗+黄狗双主角，禁止写实真狗；内容与台词顺序必须与剧本 JSON 一致。",
].join("");
