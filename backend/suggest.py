# -*- coding: utf-8 -*-
"""自动补全：英文前缀补全 + 中文释义前缀补全"""
import sqlite3

from backend.search import escape_like, is_chinese_query


def suggest(conn, q: str, limit: int):
    q = (q or "").strip()
    if not q:
        return []

def _hint(translation: str, max_len: int = 26) -> str:
    """取翻译首行作为补全预览"""
    if not translation:
        return ""
    first = translation.split("\n", 1)[0].strip()
    if len(first) > max_len:
        first = first[:max_len] + "…"
    return first


def suggest(conn, q: str, limit: int):
    q = (q or "").strip()
    if not q:
        return []

    if is_chinese_query(q):
        # 中文：查找翻译以该串开头的英文单词
        pat = escape_like(q) + "%"
        rows = conn.execute(
            "SELECT s.word, s.translation FROM stardict s "
            "WHERE s.translation LIKE ? ESCAPE '\\' "
            "ORDER BY (s.frq=0), s.frq, s.bnc LIMIT ?",
            (pat, limit * 3),
        ).fetchall()
        seen = set()
        out = []
        for r in rows:
            w = r["word"]
            if w not in seen:
                seen.add(w)
                out.append({"word": w, "hint": _hint(r["translation"])})
                if len(out) >= limit:
                    break
        return out

    # 英文：大小写无关前缀补全
    sw = q.lower()
    rows = conn.execute(
        "SELECT s.word, s.translation FROM stardict s WHERE s.sw LIKE ? "
        "ORDER BY (s.frq=0), s.frq, s.bnc LIMIT ?",
        (sw + "%", limit),
    ).fetchall()
    return [{"word": r["word"], "hint": _hint(r["translation"])} for r in rows]
