# -*- coding: utf-8 -*-
"""
语义搜索模块（服务器查询端）

- 本地不加载任何嵌入模型，查询文本通过云端 Embedding API 编码
- 向量库为 build_vectors.py 生成的 sqlite-vec 数据库（data/vectors.db）
- 向量库缺失或 API 未配置时，API 返回 503 并给出提示
"""
import json
import sqlite3
import threading
from pathlib import Path

from config import DB_PATH
from vector.embed_api import EmbeddingError, get_client, load_config

ROOT = Path(__file__).resolve().parent.parent
VECTOR_DB = ROOT / "data" / "vectors.db"          # 全量（用户回传后启用）
VECTOR_DB_COMMON = ROOT / "data" / "vectors_common.db"  # 常用子集（优先使用）


class SemanticSearchError(Exception):
    pass


class SemanticSearch:
    """语义检索器：云端编码 + sqlite-vec 暴力 kNN"""

    def __init__(self, db_path=None):
        self.db_path = Path(db_path) if db_path else (
            VECTOR_DB_COMMON if VECTOR_DB_COMMON.exists() else VECTOR_DB
        )
        self._conn = None
        self._dim = None
        self._client = None
        # FastAPI 线程池可能用不同线程处理请求，连接需跨线程复用并加锁串行化
        self._lock = threading.Lock()

    # ---- 初始化 ----

    def _ensure_ready(self):
        with self._lock:
            if self._conn is None:
                # 向量库回传可能晚于进程启动，初始化前重新探测优先级
                if VECTOR_DB_COMMON.exists():
                    self.db_path = VECTOR_DB_COMMON
                if not self.db_path.exists():
                    raise SemanticSearchError(
                        "向量库尚未建立：请在其它设备运行 build_vectors.py 生成 "
                        "vectors.db 并放回 data/ 目录"
                    )
                import sqlite_vec
                self._conn = sqlite3.connect(self.db_path, check_same_thread=False)
                self._conn.enable_load_extension(True)
                sqlite_vec.load(self._conn)
                self._conn.enable_load_extension(False)
                self._conn.row_factory = sqlite3.Row
                # 从 vec0 表定义探测维度（float[N]）
                row = self._conn.execute(
                    "SELECT sql FROM sqlite_master WHERE type='table' AND name='vec_entries'"
                ).fetchone()
                try:
                    self._dim = int(row["sql"].split("float[")[1].split("]")[0])
                except (IndexError, ValueError, TypeError) as e:
                    raise SemanticSearchError(f"向量库表结构异常：{e}") from e
            if self._client is None:
                try:
                    self._client = get_client()
                except EmbeddingError as e:
                    raise SemanticSearchError(str(e)) from e

    # ---- 查询 ----

    def _knn(self, vector, k: int):
        """向量检索，返回 [(id, distance)]"""
        self._ensure_ready()
        with self._lock:
            rows = self._conn.execute(
                "SELECT rowid, distance FROM vec_entries "
                "WHERE embedding MATCH ? AND k = ? ORDER BY distance",
                (json.dumps(vector), k),
            ).fetchall()
        return [(r["rowid"], r["distance"]) for r in rows]

    def _meta(self, ids):
        if not ids:
            return {}
        marks = ",".join("?" * len(ids))
        with self._lock:
            rows = self._conn.execute(
                f"SELECT * FROM meta WHERE id IN ({marks})", ids
            ).fetchall()
        return {r["id"]: dict(r) for r in rows}

    def search(self, query: str, k: int = 10):
        """语义搜索：中文/英文描述 -> 相关词条"""
        self._ensure_ready()
        vec = self._client.embed_one(query)
        hits = self._knn(vec, k)
        meta = self._meta([h[0] for h in hits])
        out = []
        for rid, dist in hits:
            m = meta.get(rid)
            if not m:
                continue
            out.append({
                "word": m["word"],
                "text": m["text"],
                "frq": m["frq"],
                "collins": m["collins"],
                "oxford": m["oxford"],
                "bnc": m["bnc"],
                "tag": m["tag"],
                "distance": round(dist, 6),
            })
        return out

    def similar(self, word: str, k: int = 10):
        """同近义词：与目标单词语义最相近的词条"""
        self._ensure_ready()
        text = self._word_text(word)
        if not text:
            raise SemanticSearchError(f"词库中未找到单词：{word}")
        vec = self._client.embed_one(text)
        hits = self._knn(vec, k + 5)  # 多取几个，排除自身
        meta = self._meta([h[0] for h in hits])
        out = []
        for rid, dist in hits:
            m = meta.get(rid)
            if not m or m["word"].lower() == word.lower():
                continue
            out.append({
                "word": m["word"],
                "text": m["text"],
                "frq": m["frq"],
                "collins": m["collins"],
                "oxford": m["oxford"],
                "bnc": m["bnc"],
                "tag": m["tag"],
                "distance": round(dist, 6),
            })
            if len(out) >= k:
                break
        return out

    @staticmethod
    def _word_text(word: str) -> str:
        """从 ecdict.db 构造词条嵌入文本（与 export_data.py 一致）"""
        conn = sqlite3.connect(DB_PATH)
        try:
            row = conn.execute(
                "SELECT word, translation, definition FROM stardict WHERE sw = ?",
                (word.lower(),),
            ).fetchone()
        finally:
            conn.close()
        if not row:
            return ""
        word, translation, definition = row
        parts = [word]
        if translation:
            parts.append(translation)
        if definition:
            parts.append(definition)
        return "\n".join(parts)


# 全局单例（懒加载）
_searcher = None


def get_searcher() -> SemanticSearch:
    global _searcher
    if _searcher is None:
        _searcher = SemanticSearch()
    return _searcher
