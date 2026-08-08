#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
构建语义向量数据库（sqlite-vec）—— 在【其他设备】上运行

读取 export_data.py 导出的 JSONL，调用【云端 Embedding API】编码后写入
sqlite-vec 向量库。生成的 vectors.db 回传至服务器 data/ 目录即可启用语义搜索。

⚠️ 建库与查询必须使用同一个云端模型（向量空间一致）。

用法:
    # 0. 配置云端 API（参考 vector/embed_config.example.json）
    #    把文件复制为 data/embed_config.json 并填入 base_url / model / api_key

    # 1. 安装依赖（仅需 sqlite-vec，本地不需要任何模型！）
    pip install -r vector/requirements.txt

    # 2. 常用子集（frq>0，约 4.4 万条，推荐先跑这个回传验证）
    python vector/build_vectors.py data/vector_input.jsonl data/vectors_common.db --min-frq 1

    # 3. 全量（77 万条，约需 2-6 小时，费用与 API 调用次数相关）
    python vector/build_vectors.py data/vector_input.jsonl data/vectors.db

参数:
    --min-frq N      仅索引 frq>=N 的词条（常用子集，服务器内存有限时推荐）
    --config PATH    云端 API 配置文件（默认 data/embed_config.json）
    --batch-size N   每次请求的文本条数（默认 32，按 API 限额调整）
"""
import argparse
import json
import sqlite3
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from vector.embed_api import EmbeddingError, load_config, get_client  # noqa: E402


def load_sqlite_vec():
    try:
        import sqlite_vec
        return sqlite_vec
    except ImportError:
        sys.exit("缺少 sqlite-vec，请先执行: pip install sqlite-vec")


def create_schema(conn, dim: int):
    conn.execute(f"""
        CREATE VIRTUAL TABLE IF NOT EXISTS vec_entries
        USING vec0(embedding float[{dim}])
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS meta (
            id       INTEGER PRIMARY KEY,
            word     TEXT NOT NULL,
            text     TEXT NOT NULL,
            frq      INTEGER DEFAULT 0,
            collins  INTEGER DEFAULT 0,
            oxford   INTEGER DEFAULT 0,
            bnc      INTEGER DEFAULT 0,
            tag      TEXT DEFAULT ''
        )
    """)


def main():
    ap = argparse.ArgumentParser(description="构建语义向量数据库（云端 API 编码）")
    ap.add_argument("input", type=Path, help="export_data.py 导出的 JSONL 文件")
    ap.add_argument("output", type=Path, help="输出向量库路径，如 data/vectors.db")
    ap.add_argument("--min-frq", type=int, default=0, help="仅索引 frq>=N 的词条（默认 0 = 全量）")
    ap.add_argument("--config", type=Path, default=ROOT / "data" / "embed_config.json")
    ap.add_argument("--batch-size", type=int, default=32)
    args = ap.parse_args()

    if not args.input.exists():
        sys.exit(f"找不到输入文件：{args.input}")

    print("[1/4] 加载云端 Embedding API 配置 ...", flush=True)
    client = get_client(load_config(args.config))
    print(f"      {client.base_url} / {client.model}", flush=True)

    sqlite_vec = load_sqlite_vec()
    print(f"[2/4] 创建向量库 {args.output} ...", flush=True)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(args.output)
    conn.enable_load_extension(True)
    sqlite_vec.load(conn)
    conn.enable_load_extension(False)
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA synchronous=OFF")
    # 先编码一条探测维度
    probe = client.embed_one("probe")
    dim = len(probe)
    print(f"      模型输出维度：{dim}", flush=True)
    create_schema(conn, dim)
    conn.commit()

    print("[3/4] 云端编码并写入向量 ...", flush=True)
    t1 = time.time()
    total = 0
    included = 0
    skipped = 0
    texts_batch = []
    meta_batch = []

    def flush_batch():
        nonlocal texts_batch, meta_batch
        if not texts_batch:
            return
        vecs = client.embed(texts_batch, batch_size=args.batch_size)
        if len(vecs) != len(meta_batch):
            sys.exit(f"向量数 {len(vecs)} 与词条数 {len(meta_batch)} 不一致，中止")
        conn.executemany(
            "INSERT INTO vec_entries(rowid, embedding) VALUES (?, ?)",
            [(m[0], json.dumps(v)) for m, v in zip(meta_batch, vecs)],
        )
        conn.executemany(
            "INSERT INTO meta(id, word, text, frq, collins, oxford, bnc, tag) "
            "VALUES (?,?,?,?,?,?,?,?)",
            meta_batch,
        )
        conn.commit()
        texts_batch = []
        meta_batch = []

    with open(args.input, "r", encoding="utf-8") as f:
        for line in f:
            total += 1
            item = json.loads(line)
            if args.min_frq and item["frq"] < args.min_frq:
                skipped += 1
                continue
            included += 1
            texts_batch.append(item["text"])
            meta_batch.append((
                included,
                item["word"],
                item["text"],
                item["frq"],
                item["collins"],
                item["oxford"],
                item["bnc"],
                item["tag"],
            ))
            if len(texts_batch) >= 512:
                flush_batch()
                if included % 20000 < 512:
                    el = time.time() - t1
                    print(
                        f"  ... {included} 词条已写入（{el:.0f}s，"
                        f"速度 {included / el:.0f} 条/s）",
                        flush=True,
                    )
    flush_batch()

    vec_cnt = conn.execute("SELECT count(*) FROM vec_entries").fetchone()[0]
    meta_cnt = conn.execute("SELECT count(*) FROM meta").fetchone()[0]
    conn.commit()
    conn.close()

    print(f"[4/4] 完成！读取 {total} 条，索引 {included} 条，跳过 {skipped} 条")
    print(f"      向量表 {vec_cnt} 行 / 元数据表 {meta_cnt} 行，"
          f"总耗时 {time.time() - t1:.0f}s")
    print(f"      输出文件：{args.output}（{args.output.stat().st_size / 1024 / 1024:.1f} MB）")
    print(f"      请将该文件回传至服务器 data/ 目录，完成部署。")


if __name__ == "__main__":
    try:
        main()
    except EmbeddingError as e:
        sys.exit(f"嵌入 API 错误：{e}")
