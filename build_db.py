#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
构建 ECDICT SQLite 词库：data/ecdict.csv -> data/ecdict.db

- 主表 stardict：词条全字段（word 为主键，sw 小写用于大小写无关查询）
- FTS5 全文索引（trigram tokenizer）：支持中文子串匹配（反向搜索）与英文子串匹配
- 通过触发器与主表保持同步

用法：
    python3 build_db.py [ecdict.csv路径]
"""
import csv
import sqlite3
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent
CSV_DEFAULT = ROOT / "data" / "ecdict.csv"
DB_PATH = ROOT / "data" / "ecdict.db"

SCHEMA = """
CREATE TABLE IF NOT EXISTS stardict (
  word        TEXT PRIMARY KEY,
  sw          TEXT NOT NULL,
  phonetic    TEXT,
  definition  TEXT,
  translation TEXT,
  pos         TEXT,
  collins     INTEGER DEFAULT 0,
  oxford      INTEGER DEFAULT 0,
  tag         TEXT,
  bnc         INTEGER DEFAULT 0,
  frq         INTEGER DEFAULT 0,
  exchange    TEXT,
  detail      TEXT
);

CREATE INDEX IF NOT EXISTS idx_stardict_sw ON stardict(sw);

CREATE VIRTUAL TABLE IF NOT EXISTS stardict_fts USING fts5(
  translation, definition, word,
  content='stardict', content_rowid='rowid',
  tokenize='trigram'
);

CREATE TRIGGER IF NOT EXISTS stardict_ai AFTER INSERT ON stardict BEGIN
  INSERT INTO stardict_fts(rowid, translation, definition, word)
  VALUES (new.rowid, new.translation, new.definition, new.word);
END;

CREATE TRIGGER IF NOT EXISTS stardict_ad AFTER DELETE ON stardict BEGIN
  INSERT INTO stardict_fts(stardict_fts, rowid, translation, definition, word)
  VALUES ('delete', old.rowid, old.translation, old.definition, old.word);
END;

CREATE TRIGGER IF NOT EXISTS stardict_au AFTER UPDATE ON stardict BEGIN
  INSERT INTO stardict_fts(stardict_fts, rowid, translation, definition, word)
  VALUES ('delete', old.rowid, old.translation, old.definition, old.word);
  INSERT INTO stardict_fts(rowid, translation, definition, word)
  VALUES (new.rowid, new.translation, new.definition, new.word);
END;
"""


def to_int(value):
    """空串转 0，其余转 int（失败返回 0）"""
    if not value:
        return 0
    try:
        return int(value)
    except (TypeError, ValueError):
        return 0


def clean(value):
    """去除首尾空白，None 转空串"""
    if value is None:
        return ""
    return value.strip()


def build(csv_path, db_path):
    conn = sqlite3.connect(db_path)
    conn.executescript(SCHEMA)
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA synchronous=OFF")
    conn.execute("PRAGMA cache_size=-65536")

    total = 0
    skipped = 0
    batch = []
    t0 = time.time()

    with open(csv_path, "r", encoding="utf-8", newline="") as f:
        reader = csv.DictReader(f)
        for row in reader:
            word = clean(row.get("word", ""))
            if not word:
                skipped += 1
                continue
            batch.append((
                word,
                word.lower(),
                clean(row.get("phonetic", "")),
                clean(row.get("definition", "")),
                clean(row.get("translation", "")),
                clean(row.get("pos", "")),
                to_int(row.get("collins", "")),
                to_int(row.get("oxford", "")),
                clean(row.get("tag", "")),
                to_int(row.get("bnc", "")),
                to_int(row.get("frq", "")),
                clean(row.get("exchange", "")),
                clean(row.get("detail", "")),
            ))
            total += 1
            if len(batch) >= 5000:
                conn.executemany(
                    "INSERT OR REPLACE INTO stardict VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
                    batch,
                )
                batch = []
                if total % 100000 < 5000:
                    print(f"  ... {total} 词条已导入", flush=True)
        if batch:
            conn.executemany(
                "INSERT OR REPLACE INTO stardict VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
                batch,
            )

    conn.commit()

    # 索引统计
    zh_cnt = conn.execute(
        "SELECT count(*) FROM stardict WHERE translation != ''"
    ).fetchone()[0]
    with_translation = conn.execute(
        "SELECT count(*) FROM stardict WHERE translation != ''"
    ).fetchone()[0]
    # FTS 表校验（trigram 需要至少 3 字符才可查询，这里只统计行数）
    fts_cnt = conn.execute("SELECT count(*) FROM stardict_fts").fetchone()[0]
    conn.commit()
    conn.close()

    elapsed = time.time() - t0
    print(f"完成：{total} 词条（跳过 {skipped}），其中 {zh_cnt} 条含中文翻译")
    print(f"FTS 索引行数：{fts_cnt}，耗时 {elapsed:.1f}s")
    print(f"数据库文件：{db_path}（{db_path.stat().st_size / 1024 / 1024:.1f} MB）")


if __name__ == "__main__":
    csv_file = Path(sys.argv[1]) if len(sys.argv) > 1 else CSV_DEFAULT
    if not csv_file.exists():
        sys.exit(f"找不到词库 CSV：{csv_file}，请先下载 ECDICT 数据")
    build(csv_file, DB_PATH)
