# -*- coding: utf-8 -*-
"""
云端 Embedding API 客户端（OpenAI 兼容格式）

支持 OpenAI、智谱、阿里 DashScope、DeepSeek、vLLM 等兼容
POST {base_url}/embeddings 接口的服务。

配置（data/embed_config.json）：
{
    "base_url": "https://api.openai.com/v1",
    "model": "text-embedding-3-small",
    "dimensions": null,      // 可选，限制输出维度
    "api_key": "sk-...",     // 可选，也可用环境变量 EMBED_API_KEY
    "batch_size": 32
}
"""
import json
import os
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CONFIG_FILE = ROOT / "data" / "embed_config.json"


class EmbeddingError(Exception):
    pass


class EmbeddingClient:
    def __init__(self, base_url: str, api_key: str, model: str,
                 dimensions: int = None, batch_size: int = 32,
                 timeout: int = 60, retries: int = 3):
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key
        self.model = model
        self.dimensions = dimensions
        self.batch_size = batch_size
        self.timeout = timeout
        self.retries = retries

    # ---- 公开接口 ----

    def embed(self, texts):
        """批量编码文本列表，返回向量列表（顺序与输入一致）"""
        out = []
        for i in range(0, len(texts), self.batch_size):
            batch = texts[i:i + self.batch_size]
            out.extend(self._embed_batch(batch))
        return out

    def embed_one(self, text):
        return self.embed([text])[0]

    # ---- 内部 ----

    def _embed_batch(self, texts):
        body = {"model": self.model, "input": texts}
        if self.dimensions:
            body["dimensions"] = self.dimensions
        data = self._post("/embeddings", body)
        try:
            items = sorted(data["data"], key=lambda x: x.get("index", 0))
            vecs = [it["embedding"] for it in items]
        except (KeyError, TypeError) as e:
            raise EmbeddingError(f"响应格式异常：{e}") from e
        if len(vecs) != len(texts):
            raise EmbeddingError(
                f"返回向量数 {len(vecs)} 与请求数 {len(texts)} 不一致"
            )
        return vecs

    def _post(self, path, body):
        url = self.base_url + path
        data = json.dumps(body).encode("utf-8")
        headers = {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {self.api_key}",
        }
        last_err = None
        for attempt in range(self.retries):
            try:
                req = urllib.request.Request(url, data=data, headers=headers)
                with urllib.request.urlopen(req, timeout=self.timeout) as resp:
                    return json.loads(resp.read().decode("utf-8"))
            except urllib.error.HTTPError as e:
                detail = e.read().decode("utf-8", "replace")[:300]
                last_err = EmbeddingError(
                    f"HTTP {e.code}：{detail}"
                )
                if e.code in (400, 401, 403, 404):
                    raise last_err  # 配置错误，重试无意义
            except (urllib.error.URLError, TimeoutError, ConnectionError) as e:
                last_err = EmbeddingError(f"网络错误：{e}")
            time.sleep(2 * (attempt + 1))
        raise last_err or EmbeddingError("未知错误")


def load_config(path: Path = CONFIG_FILE) -> dict:
    """读取嵌入 API 配置；api_key 优先取环境变量 EMBED_API_KEY"""
    if not path.exists():
        return {}
    cfg = json.loads(path.read_text(encoding="utf-8"))
    cfg["api_key"] = os.environ.get("EMBED_API_KEY") or cfg.get("api_key", "")
    return cfg


def get_client(cfg: dict = None) -> EmbeddingClient:
    """根据配置构建客户端；配置缺失时抛 EmbeddingError"""
    cfg = cfg if cfg is not None else load_config()
    if not cfg.get("base_url") or not cfg.get("model"):
        raise EmbeddingError(
            "未配置嵌入 API：请填写 data/embed_config.json（参考 "
            "vector/embed_config.example.json），或设置环境变量 EMBED_API_KEY"
        )
    if not cfg.get("api_key"):
        raise EmbeddingError("缺少 API key：请填写 data/embed_config.json 的 "
                             "api_key 或设置环境变量 EMBED_API_KEY")
    return EmbeddingClient(
        base_url=cfg["base_url"],
        api_key=cfg["api_key"],
        model=cfg["model"],
        dimensions=cfg.get("dimensions"),
        batch_size=cfg.get("batch_size", 32),
    )
