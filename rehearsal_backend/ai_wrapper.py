"""
统一大模型调用层（OpenAI 兼容）。

业务与 LangGraph 节点只应通过本模块的异步函数访问 LLM。
更换 API Key、Base URL 或模型名时，仅需改环境变量或本文件内的读取逻辑，
勿修改 rehearsal_graph.py。
"""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

from dotenv import load_dotenv
from langchain_core.messages import HumanMessage
from langchain_openai import ChatOpenAI

# 启动时加载与脚本同目录的 .env.local（也可在运行前 export 同名变量）
_ENV_PATH = Path(__file__).resolve().parent / ".env.local"
load_dotenv(_ENV_PATH, override=False)

_llm: ChatOpenAI | None = None


def init_llm() -> ChatOpenAI:
    """
    从环境变量初始化全局 ChatOpenAI 实例。

    使用变量名与 .env.local 一致，便于与前端共用一份配置说明：
    - VITE_LLM_API_KEY
    - VITE_LLM_API_URL（OpenAI 兼容 /v1）
    - VITE_LLM_MODEL
    """
    global _llm
    if _llm is not None:
        return _llm

    api_key = os.getenv("VITE_LLM_API_KEY", "").strip()
    base_url = os.getenv("VITE_LLM_API_URL", "https://api.openai.com/v1").strip().rstrip("/")
    model = os.getenv("VITE_LLM_MODEL", "gpt-4o").strip()

    if not api_key or api_key == "your_api_key_here":
        raise ValueError(
            "请在 .env.local 中设置有效的 VITE_LLM_API_KEY（当前为空或为占位符）。"
        )

    # 多数兼容服务与 OpenAI 一致，根 URL 已含 /v1；ChatOpenAI 会再拼 /chat/completions
    _llm = ChatOpenAI(
        api_key=api_key,
        base_url=base_url,
        model=model,
        temperature=0.7,
    )
    return _llm


def _get_llm() -> ChatOpenAI:
    return _llm if _llm is not None else init_llm()


async def call_llm_standard(prompt: str) -> str:
    """标准单轮文本生成，返回助手纯文本内容。"""
    llm = _get_llm()
    msg = await llm.ainvoke([HumanMessage(content=prompt)])
    content = msg.content
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts: list[str] = []
        for block in content:
            if isinstance(block, dict) and block.get("type") == "text":
                parts.append(str(block.get("text", "")))
            else:
                parts.append(str(block))
        return "".join(parts)
    return str(content)


async def call_llm_json(prompt: str) -> dict[str, Any]:
    """
    强制 JSON 输出：通过 OpenAI 兼容的 response_format=json_object，
    再解析为 dict。若服务商不支持，可仅改本函数实现（图逻辑仍不变）。
    """
    llm = _get_llm().bind(
        response_format={"type": "json_object"},
    )
    msg = await llm.ainvoke([HumanMessage(content=prompt)])
    raw = msg.content
    text = raw if isinstance(raw, str) else str(raw)
    text = text.strip()
    try:
        parsed = json.loads(text)
    except json.JSONDecodeError as e:
        raise ValueError(f"LLM 返回非合法 JSON: {e}\n---\n{text[:2000]}") from e
    if not isinstance(parsed, dict):
        raise TypeError(f"期望 JSON 对象，得到: {type(parsed).__name__}")
    return parsed
