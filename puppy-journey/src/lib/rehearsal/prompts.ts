/**
 * 与 `rehearsal_backend/rehearsal_graph.py` 中的常量保持语义一致；
 * 修改 Prompt 时请同步 Python 端。
 */

export const AGENT1_PROMPT = `解析用户上传文字信息（你将结合从【成就页、旅行页、心愿页接口】获取的数据进行深度意图分析）。

请根据下方「用户文字」与可选「业务上下文」输出：意图摘要、关键实体、学习/排练相关建议（纯文本即可）。`;

export const AGENT2_PROMPT = `解析用户上传语音信息（你将结合从【成就页、心愿页接口】获取的数据分析情绪基调）。

请根据下方「语音说明/URL」与可选上下文，输出：情绪基调、语速/能量推测、对排练场景的启示（纯文本即可）。`;

export const AGENT3_PROMPT = `解析用户上传图片信息（你将结合从【旅行页接口】获取的数据分析场景和氛围）。

请根据下方「图片说明/URL」与可选上下文，输出：场景元素、氛围、与西语学习场景的可能关联（纯文本即可）。`;

export const AGENT4_PROMPT = `多模态信息融合：将 Agent1/2/3 的解析结果融合成结构化西语语料信息。

输出一份连贯的「融合语料」纯文本：包含主题、难度建议、推荐场景关键词、可教句式方向，便于后续生成剧本。`;

export const AGENT5_PROMPT = `构建场景，生成npc角色语言剧本（如：巴塞罗那的服务员）以及两个小狗对话剧本，区分哪句是哪个小狗说的。必须严格按以下JSON格式输出，包含时间戳：
{
  "scene": "巴塞罗那的百年咖啡馆",
  "theme": "初级点单对话",
  "script": [
    { "id": 1, "type": "npc", "character": "服务员", "text": "¡Hola! ¿Qué van a tomar?", "translation": "你好！你们要喝点什么？", "startTime": 0.0, "endTime": 2.5 },
    { "id": 2, "type": "player", "character": "白狗", "text": "Un café con leche, por favor.", "translation": "请给我一杯拿铁。", "startTime": 3.0, "endTime": 5.5 },
    { "id": 3, "type": "player", "character": "黄狗", "text": "Y un cortado para mí, gracias.", "translation": "我要一杯可塔朵，谢谢。", "startTime": 6.0, "endTime": 8.5 }
  ]
}

只输出一个 JSON 对象，不要 Markdown 代码围栏。`;

export const AGENT8_PROMPT = `总结生成有声单词卡片：从剧本中提取核心西语词汇，生成卡片数据。

请以易读的结构化纯文本输出多张卡片，每张包含：西语词、中文释义、例句（来自剧本优先）、难度标签。`;

export const AGENT7_SOS_PROMPT = `互动游戏小助手：用户读不出来时，提供该单句的西语发音提示和朗读指导。

要求：简洁、可跟读；说明重音与常见易错音；如需可给慢速朗读节奏提示（文字描述即可）。`;
