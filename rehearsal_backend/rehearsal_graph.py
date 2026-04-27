"""
「未来排练室 / 外语大战」多智能体 LangGraph 编排。

DAG: START -> perception_node -> fusion_node -> script_node -> media_node -> END

所有 LLM 调用均委托 ai_wrapper，本文件只负责状态与节点业务逻辑。
"""

from __future__ import annotations

import asyncio
import json
import uuid
from typing import Any, TypedDict

from langgraph.graph import END, START, StateGraph

from ai_wrapper import call_llm_json, call_llm_standard, init_llm

# ---------------------------------------------------------------------------
# Prompt 常量（描述已写入模板，供各 Agent 使用）
# ---------------------------------------------------------------------------

AGENT1_PROMPT = """解析用户上传文字信息（你将结合从【成就页、旅行页、心愿页接口】获取的数据进行深度意图分析）。

请根据下方「用户文字」与可选「业务上下文」输出：意图摘要、关键实体、学习/排练相关建议（纯文本即可）。"""

AGENT2_PROMPT = """解析用户上传语音信息（你将结合从【成就页、心愿页接口】获取的数据分析情绪基调）。

请根据下方「语音说明/URL」与可选上下文，输出：情绪基调、语速/能量推测、对排练场景的启示（纯文本即可）。"""

AGENT3_PROMPT = """解析用户上传图片信息（你将结合从【旅行页接口】获取的数据分析场景和氛围）。

请根据下方「图片说明/URL」与可选上下文，输出：场景元素、氛围、与西语学习场景的可能关联（纯文本即可）。"""

AGENT4_PROMPT = """多模态信息融合：将 Agent1/2/3 的解析结果融合成结构化西语语料信息。

输出一份连贯的「融合语料」纯文本：包含主题、难度建议、推荐场景关键词、可教句式方向，便于后续生成剧本。"""

AGENT5_PROMPT = """构建场景，生成npc角色语言剧本（如：巴塞罗那的服务员）以及两个小狗对话剧本，区分哪句是哪个小狗说的。必须严格按以下JSON格式输出，包含时间戳：
{
  "scene": "巴塞罗那的百年咖啡馆",
  "theme": "初级点单对话",
  "script": [
    { "id": 1, "type": "npc", "character": "服务员", "text": "¡Hola! ¿Qué van a tomar?", "translation": "你好！你们要喝点什么？", "startTime": 0.0, "endTime": 2.5 },
    { "id": 2, "type": "player", "character": "白狗", "text": "Un café con leche, por favor.", "translation": "请给我一杯拿铁。", "startTime": 3.0, "endTime": 5.5 },
    { "id": 3, "type": "player", "character": "黄狗", "text": "Y un cortado para mí, gracias.", "translation": "我要一杯可塔朵，谢谢。", "startTime": 6.0, "endTime": 8.5 }
  ]
}

只输出一个 JSON 对象，不要 Markdown 代码围栏。"""

AGENT8_PROMPT = """总结生成有声单词卡片：从剧本中提取核心西语词汇，生成卡片数据。

请以易读的结构化纯文本输出多张卡片，每张包含：西语词、中文释义、例句（来自剧本优先）、难度标签。"""

AGENT7_SOS_PROMPT = """互动游戏小助手：用户读不出来时，提供该单句的西语发音提示和朗读指导。

要求：简洁、可跟读；说明重音与常见易错音；如需可给慢速朗读节奏提示（文字描述即可）。"""


# ---------------------------------------------------------------------------
# 状态定义（LangGraph 状态传递：节点返回 dict 合并进状态）
# ---------------------------------------------------------------------------


class RehearsalState(TypedDict, total=False):
    """排练流水线状态：输入 -> 感知 -> 融合 -> 剧本 -> 媒体与词汇。"""

    # 输入
    user_text: str
    user_audio_url: str
    user_image_url: str
    # 可选：由调用方注入的「成就/旅行/心愿」接口摘要，便于 Agent 1/2/3 使用
    context_achievements: str
    context_travel: str
    context_wishes: str

    # Agent 1 / 2 / 3
    parsed_text: str
    parsed_audio: str
    parsed_image: str

    # Agent 4 / 5
    fused_corpus: str
    script_data: dict[str, Any]

    # Agent 6 / 8
    video_url: str
    vocab_cards: str


def _empty_note(label: str, value: str | None) -> str:
    v = (value or "").strip()
    return v if v else f"（未提供{label}）"


# ---------------------------------------------------------------------------
# Agent 6：视频生成 Mock（真实环境可改为调用视频大模型 API，仍建议放在独立模块）
# ---------------------------------------------------------------------------


async def mock_agent6_generate_video(script_data: dict[str, Any]) -> str:
    """
    模拟视频大模型：根据剧本返回入门级西语学习视频 URL。

    前端双模式说明（请在实现前端时遵循）：
    - 观影模式：音轨全开，按成片播放即可。
    - 配音模式：依赖 script_data 中每条 line 的 startTime/endTime；
      当轮到 type==\"player\" 的回合时，将视频/对白音轨 muted=true，
      并显示大号高亮字幕引导用户跟读；NPC 句可保持原音或按产品策略处理。
    """
    await asyncio.sleep(0.05)
    scene = script_data.get("scene", "spanish-lesson")
    safe = str(scene).replace(" ", "-")[:40]
    rid = uuid.uuid4().hex[:8]
    return f"https://mock-video.example.com/es-beginner/{safe}/{rid}.mp4"


# ---------------------------------------------------------------------------
# 节点实现
# ---------------------------------------------------------------------------


async def perception_node(state: RehearsalState) -> dict[str, str]:
    """
    感知节点：并发执行 Agent 1、2、3（彼此无依赖，使用 asyncio.gather）。
    """
    achievements = _empty_note("成就页摘要", state.get("context_achievements"))
    travel = _empty_note("旅行页摘要", state.get("context_travel"))
    wishes = _empty_note("心愿页摘要", state.get("context_wishes"))

    user_text = _empty_note("用户文字", state.get("user_text"))
    user_audio = _empty_note("用户语音URL或说明", state.get("user_audio_url"))
    user_image = _empty_note("用户图片URL或说明", state.get("user_image_url"))

    p1 = "\n\n".join(
        [
            AGENT1_PROMPT,
            f"用户文字：{user_text}",
            f"成就页上下文：{achievements}",
            f"旅行页上下文：{travel}",
            f"心愿页上下文：{wishes}",
        ]
    )
    p2 = "\n\n".join(
        [
            AGENT2_PROMPT,
            f"语音输入：{user_audio}",
            f"成就页上下文：{achievements}",
            f"心愿页上下文：{wishes}",
        ]
    )
    p3 = "\n\n".join(
        [
            AGENT3_PROMPT,
            f"图片输入：{user_image}",
            f"旅行页上下文：{travel}",
        ]
    )

    parsed_text, parsed_audio, parsed_image = await asyncio.gather(
        call_llm_standard(p1),
        call_llm_standard(p2),
        call_llm_standard(p3),
    )
    return {
        "parsed_text": parsed_text,
        "parsed_audio": parsed_audio,
        "parsed_image": parsed_image,
    }


async def fusion_node(state: RehearsalState) -> dict[str, str]:
    """Agent 4：融合多模态解析结果。"""
    block = "\n\n".join(
        [
            f"【Agent1 文字解析】\n{state.get('parsed_text', '')}",
            f"【Agent2 语音解析】\n{state.get('parsed_audio', '')}",
            f"【Agent3 图片解析】\n{state.get('parsed_image', '')}",
        ]
    )
    prompt = f"{AGENT4_PROMPT}\n\n{block}"
    fused = await call_llm_standard(prompt)
    return {"fused_corpus": fused}


async def script_node(state: RehearsalState) -> dict[str, dict[str, Any]]:
    """Agent 5：根据融合语料生成带时间戳与角色标识的 JSON 剧本。"""
    corpus = state.get("fused_corpus", "").strip() or "（语料为空，请生成通用初级西语咖啡馆点单场景）"
    prompt = f"{AGENT5_PROMPT}\n\n融合语料：\n{corpus}"
    script_data = await call_llm_json(prompt)
    return {"script_data": script_data}


async def media_node(state: RehearsalState) -> dict[str, str]:
    """
    媒体节点：Agent 6（视频 Mock）与 Agent 8（单词卡）无彼此依赖，使用 asyncio.gather 并发。
    """
    script = state.get("script_data") or {}
    script_json = json.dumps(script, ensure_ascii=False, indent=2)

    async def run_vocab() -> str:
        prompt = f"{AGENT8_PROMPT}\n\n剧本JSON：\n{script_json}"
        return await call_llm_standard(prompt)

    video_url, vocab_cards = await asyncio.gather(
        mock_agent6_generate_video(script),
        run_vocab(),
    )
    return {"video_url": video_url, "vocab_cards": vocab_cards}


# ---------------------------------------------------------------------------
# Agent 7：图外独立接口（配音卡壳实时调用）
# ---------------------------------------------------------------------------


async def agent7_sos_assistant(sentence: str) -> str:
    """互动游戏小助手：针对单句提供发音与朗读指导。"""
    s = (sentence or "").strip()
    if not s:
        return "请提供需要帮助的西语句子。"
    prompt = f"{AGENT7_SOS_PROMPT}\n\n用户卡住的句子：\n{s}"
    return await call_llm_standard(prompt)


# ---------------------------------------------------------------------------
# 构建 DAG
# ---------------------------------------------------------------------------


def build_rehearsal_graph():
    graph = StateGraph(RehearsalState)
    graph.add_node("perception", perception_node)
    graph.add_node("fusion", fusion_node)
    graph.add_node("script", script_node)
    graph.add_node("media", media_node)

    graph.add_edge(START, "perception")
    graph.add_edge("perception", "fusion")
    graph.add_edge("fusion", "script")
    graph.add_edge("script", "media")
    graph.add_edge("media", END)

    return graph.compile()


# 编译后的默认可执行图（也可在测试中调用 build_rehearsal_graph()）
rehearsal_app = build_rehearsal_graph()


async def main() -> None:
    """使用 Mock 输入跑通整条流水线（需有效 API Key）。"""
    init_llm()
    initial: RehearsalState = {
        "user_text": "我想练咖啡馆点单，初级就行。",
        "user_audio_url": "https://mock.cdn.example.com/user-tone-sample.webm",
        "user_image_url": "https://mock.cdn.example.com/cafe-photo.jpg",
        "context_achievements": "Mock：近期完成「每日打卡」3 次。",
        "context_travel": "Mock：计划城市巴塞罗那。",
        "context_wishes": "Mock：心愿「和搭档流利点一杯咖啡」。",
    }
    final_state = await rehearsal_app.ainvoke(initial)
    print("--- fused_corpus (excerpt) ---")
    print((final_state.get("fused_corpus") or "")[:500], "...\n")
    print("--- script_data keys ---", list((final_state.get("script_data") or {}).keys()))
    print("--- video_url ---", final_state.get("video_url"))
    print("--- vocab_cards (excerpt) ---")
    print((final_state.get("vocab_cards") or "")[:500], "...\n")

    sos = await agent7_sos_assistant("Un café con leche, por favor.")
    print("--- agent7_sos_assistant ---\n", sos[:400], "...\n")


if __name__ == "__main__":
    asyncio.run(main())
