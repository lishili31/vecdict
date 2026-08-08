# -*- coding: utf-8 -*-
"""关键词搜索逻辑：英文前缀/模糊匹配 + 中文释义反向搜索"""
import json
import re
import sqlite3

from config import FUZZY_PREFIX_LEN, MAX_EDIT_DISTANCE

CJK_RE = re.compile(r"[\u4e00-\u9fff]")


def is_chinese_query(q: str) -> bool:
    return bool(CJK_RE.search(q))


def escape_like(s: str) -> str:
    """转义 LIKE 模式中的通配符"""
    return s.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def parse_text_list(raw: str):
    """释义字段 -> 行列表

    兼容两种数据格式：
    - 普通多行文本："n. 苹果\\n[医] 苹果"
    - JSON 数组字符串：["n. 苹果", "[医] 苹果"]
    """
    if not raw:
        return []
    s = raw.strip()
    if s.startswith("["):
        try:
            v = json.loads(s)
            if isinstance(v, list):
                return [str(x).strip() for x in v if str(x).strip()]
        except (json.JSONDecodeError, TypeError):
            pass
    return [line.strip() for line in s.split("\n") if line.strip()]


# exchange 旧格式前缀 -> 标准变形名（p:/d:/3:/i:/s:/r:/t:）
EXCHANGE_PREFIX_MAP = {
    "p": "past",      # 过去式
    "d": "done",      # 过去分词
    "3": "third",     # 第三人称单数
    "i": "ing",       # 现在分词
    "s": "pl",        # 复数
    "r": "er",        # 比较级
    "t": "est",       # 最高级
}


def parse_exchange(raw: str) -> dict:
    """词形变化 -> dict

    兼容 JSON 对象与 ECDICT 旧格式（p:xxx/d:xxx/...）。
    """
    if not raw:
        return {}
    s = raw.strip()
    if s.startswith("{"):
        try:
            v = json.loads(s)
            if isinstance(v, dict):
                return v
        except (json.JSONDecodeError, TypeError):
            pass
    out = {}
    for part in s.split("/"):
        if ":" not in part:
            continue
        k, v = part.split(":", 1)
        label = EXCHANGE_PREFIX_MAP.get(k.strip())
        if label and v:
            out[label] = [v]
    return out


def row_to_entry(row: sqlite3.Row) -> dict:
    return {
        "word": row["word"],
        "phonetic": row["phonetic"] or "",
        "pos": row["pos"] or "",
        "definition": parse_text_list(row["definition"]),
        "translation": parse_text_list(row["translation"]),
        "collins": row["collins"] or 0,
        "oxford": row["oxford"] or 0,
        "tag": row["tag"] or "",
        "bnc": row["bnc"] or 0,
        "frq": row["frq"] or 0,
        "exchange": parse_exchange(row["exchange"]),
    }


def _edit_distance(a: str, b: str) -> int:
    """Levenshtein 编辑距离"""
    if abs(len(a) - len(b)) > MAX_EDIT_DISTANCE:
        return MAX_EDIT_DISTANCE + 1
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        cur = [i]
        for j, cb in enumerate(b, 1):
            cur.append(min(
                prev[j] + 1,
                cur[j - 1] + 1,
                prev[j - 1] + (0 if ca == cb else 1),
            ))
        prev = cur
    return prev[-1]


def _freq_rank(row: sqlite3.Row):
    """词频排序键：frq 越小越常用，0 表示未收录词频"""
    frq = row["frq"] or 0
    return (0 if frq > 0 else 1, frq, row["bnc"] or 0)


# ---------------------------------------------------------------------------
# 英文搜索
# ---------------------------------------------------------------------------

def _search_en(conn, q: str, limit: int, offset: int):
    sw = q.lower().strip()
    candidates = []  # (排序键, 词条)；排序键 = (常用, 编辑距离, frq, bnc)
    seen = set()

    # 1. 精确匹配
    row = conn.execute("SELECT * FROM stardict WHERE sw = ?", (sw,)).fetchone()
    if row is not None:
        candidates.append(((-1, 0, 0, 0), row))
        seen.add(row["word"])

    # 2. 前缀匹配（编辑距离 0）
    rows = conn.execute(
        "SELECT * FROM stardict WHERE sw LIKE ? AND sw != ? "
        "ORDER BY (frq=0), frq, bnc LIMIT ?",
        (sw + "%", sw, limit + offset + 50),
    ).fetchall()
    for r in rows:
        if r["word"] not in seen:
            candidates.append((_freq_rank(r) + (0,), r))
            seen.add(r["word"])

    # 3. 编辑距离模糊匹配：精确未命中时补充，覆盖拼写错误场景。
    #    常用词（有词频）优先于罕见词，编辑距离近者优先。
    if row is None and len(sw) >= FUZZY_PREFIX_LEN:
        prefix = sw[:FUZZY_PREFIX_LEN]
        rows = conn.execute(
            "SELECT * FROM stardict WHERE sw LIKE ? AND sw != ? "
            "ORDER BY (frq=0), frq, bnc LIMIT 500",
            (prefix + "%", sw),
        ).fetchall()
        for r in rows:
            if r["word"] in seen:
                continue
            d = _edit_distance(sw, r["word"])
            if 1 <= d <= MAX_EDIT_DISTANCE:
                candidates.append((_freq_rank(r) + (d,), r))
                seen.add(r["word"])

    candidates.sort(key=lambda x: x[0])
    total = len(candidates)
    page = [row_to_entry(r) for _, r in candidates[offset:offset + limit]]
    return total, page


# ---------------------------------------------------------------------------
# 中文搜索（释义反向搜索）
# ---------------------------------------------------------------------------

def _search_zh(conn, q: str, limit: int, offset: int):
    q = q.strip()
    base_sql = (
        "SELECT count(*) FROM stardict_fts f JOIN stardict s ON s.rowid = f.rowid "
        "WHERE stardict_fts MATCH ?"
    )

    if len(q) >= 3:
        # FTS5 trigram 子串匹配（索引查询，性能好）
        match = '"' + q.replace('"', '""') + '"'
        total = conn.execute(base_sql, (match,)).fetchone()[0]
        rows = conn.execute(
            "SELECT s.* FROM stardict_fts f JOIN stardict s ON s.rowid = f.rowid "
            "WHERE stardict_fts MATCH ? ORDER BY (s.frq=0), s.frq, s.bnc "
            "LIMIT ? OFFSET ?",
            (match, limit, offset),
        ).fetchall()
    else:
        # 1-2 字符：trigram 无法匹配，退化为 LIKE 全表扫描
        pat = escape_like(q)
        where = (
            "WHERE s.translation LIKE ? ESCAPE '\\' "
            "OR s.definition LIKE ? ESCAPE '\\'"
        )
        total = conn.execute(
            f"SELECT count(*) FROM stardict s {where}", (f"%{pat}%", f"%{pat}%")
        ).fetchone()[0]
        rows = conn.execute(
            f"SELECT s.* FROM stardict s {where} "
            "ORDER BY (s.frq=0), s.frq, s.bnc LIMIT ? OFFSET ?",
            (f"%{pat}%", f"%{pat}%", limit, offset),
        ).fetchall()

    return total, [row_to_entry(r) for r in rows]


# ---------------------------------------------------------------------------
# 对外入口
# ---------------------------------------------------------------------------

def search(conn, q: str, limit: int, offset: int):
    q = (q or "").strip()
    if not q:
        return 0, []
    if is_chinese_query(q):
        return _search_zh(conn, q, limit, offset)
    return _search_en(conn, q, limit, offset)
