# 向量化语义搜索 · 使用说明

词典应用接入向量语义搜索的分工：

| 环节 | 设备 | 状态 |
|------|------|------|
| 数据导出 | 服务器 | ✅ 已生成 `data/vector_input.jsonl`（77 万词条） |
| 向量建库 | **你的其他设备** | 🔄 你本地运行中（bge-m3 / 1024 维，脚本已自行适配） |
| 语义查询 | 服务器 | ✅ API 已就绪，等向量库回传后自动启用 |

⚠️ 建库与查询必须使用**同一个模型**（bge-m3），否则向量空间不一致、检索无效。
服务器查询端已按 rag 项目配置对接同款 bge-m3 嵌入 API（云端 OpenAI 兼容服务，
`data/embed_config.json`，已 gitignore）。

---

## 一、服务器端现状

- 查询 API：`/dict/api/semantic`（描述→单词）、`/dict/api/similar`（同近义词）
- 向量库缺失时返回 503 提示；`data/vectors_common.db` 存在时优先使用
- 服务由 **deploy 用户 pm2** 托管（进程名 `dict-web`）：
  ```bash
  sudo -u deploy pm2 status dict-web
  sudo -u deploy pm2 logs dict-web
  sudo -u deploy pm2 restart dict-web
  ```

## 二、向量库格式约定（建库脚本输出必须匹配）

查询端 `vector/semantic_search.py` 依赖以下 schema，建库脚本请按此输出：

```sql
-- 向量表（维度 = 模型输出维度 1024，必须与查询端 API 一致）
CREATE VIRTUAL TABLE vec_entries USING vec0(embedding float[1024]);

-- 元数据表（rowid 从 1 开始，与 vec_entries.rowid 一一对应）
CREATE TABLE meta (
    id       INTEGER PRIMARY KEY,   -- = vec_entries.rowid
    word     TEXT NOT NULL,         -- 英文单词
    text     TEXT NOT NULL,         -- 嵌入文本（word + 中文释义 + 英文释义）
    frq      INTEGER DEFAULT 0,
    collins  INTEGER DEFAULT 0,
    oxford   INTEGER DEFAULT 0,
    bnc      INTEGER DEFAULT 0,
    tag      TEXT DEFAULT ''
);
```

其他约定：
- 向量为 **float32 列表**（JSON 数组文本形式插入，如 `"[0.1,0.2,...]"`）
- 建议向量做 **L2 归一化**（与云端 bge-m3 API 输出一致，模长=1）
- 文件为 SQLite 格式（sqlite-vec 扩展），回传后放到服务器 `data/` 目录

## 三、回传与启用

把生成的 `vectors_common.db`（或 `vectors.db`）拷回服务器
`/home/deploy/code/wordsearch/data/` 目录即可，无需重启服务：
`/api/semantic`、`/api/similar` 立即生效（优先使用 `vectors_common.db`）。

## 四、查询 API

| 接口 | 说明 | 示例 |
|------|------|------|
| `GET /api/semantic?q=描述&limit=10` | 反向词典：中文/英文描述 → 相关单词 | `q=形容坚持不懈` |
| `GET /api/similar?word=单词&limit=10` | 同近义词推荐 | `word=happy` |

返回示例：

```json
{
  "query": "形容坚持不懈",
  "results": [
    {"word": "perseverance", "text": "...", "frq": 1000, "collins": 3,
     "oxford": 1, "bnc": 12000, "tag": "cet6 ky", "distance": 0.15}
  ]
}
```

## 五、注意事项

- 服务器内存 1.7GB：常用子集（约 4.4 万条）查询无压力；全量 77 万条
  × 1024 维 × 4B ≈ 3.1GB，查询会占用大量内存，不建议放在本服务器查询
- 换模型后必须重新建库（旧向量库与新查询向量不兼容）
- API key 存于 `data/embed_config.json`（权限 600，已 gitignore），
  也可用环境变量 `EMBED_API_KEY` 覆盖
