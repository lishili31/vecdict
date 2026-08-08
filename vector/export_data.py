#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
从 ecdict.db 导出向量化建库输入数据（JSONL）

输出: data/vector_input.jsonl
每行一个词条:
    {"word": "hello", "text": "hello\\nint. 喂, 嘿\\nn. an expression of greeting",
     "frq": 2238, "collins": 3, "oxford": 1, "bnc": 2319, "tag": "zk gk"}

text 为向量化嵌入文本（单词 + 中文释义 + 英文释义），供跨语言语义搜索与同近义词推荐使用。

用法:
    python vector/export_data.py
"""
import json
import sqlite3
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DB_PATH = ROOT / "data" / "ecdict.db"
OUT_PATH = ROOT / "data" / "vector_input.jsonl"


def build_text(word: str, translation: str, definition: str) -> str:
    """构造嵌入文本：单词 + 中文释义 + 英文释义"""
    parts = [word]
    if translation:
        parts.append(translation)
    if definition:
        parts.append(definition)
    return "\n".join(parts)


def export(db_path: Path, out_path: Path):
    conn = sqlite3.connect(db_path)
    total = 0
    t0 = time.time()

    with open(out_path, "w", encoding="utf-8") as f:
        cur = conn.execute(
            "SELECT word, translation, definition, frq, collins, oxford, bnc, tag "
            "FROM stardict"
        )
        for word, translation, definition, frq, collins, oxford, bnc, tag in cur:
            f.write(json.dumps({
                "word": word,
                "text": build_text(word, translation or "", definition or ""),
                "frq": frq or 0,
                "collins": collins or 0,
                "oxford": oxford or 0,
                "bnc": bnc or 0,
                "tag": tag or "",
            }, ensure_ascii=False) + "\n")
            total += 1
            if total % 200000 == 0:
                print(f"  ... {total} 词条已导出", flush=True)

    conn.close()
    size_mb = out_path.stat().st_size / 1024 / 1024
    print(f"完成：{total} 词条，耗时 {time.time() - t0:.1f}s")
    print(f"输出文件：{out_path}（{size_mb:.1f} MB）")


if __name__ == "__main__":
    db = Path(sys.argv[1]) if len(sys.argv) > 1 else DB_PATH
    out = Path(sys.argv[2]) if len(sys.argv) > 2 else OUT_PATH
    if not db.exists():
        sys.exit(f"找不到词库：{db}，请先构建 ecdict.db")
    export(db, out)
