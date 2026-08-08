# 向量化语义搜索 · 使用说明

词典应用接入向量语义搜索的分工：

| 环节 | 设备 | 脚本 |
|------|------|------|
| 数据导出 | 服务器 | `vector/export_data.py`（已生成 `data/vector_input.jsonl`） |
| 向量建库 | **你的其他设备** | `vector/build_vectors.py` |
| 语义查询 | 服务器（云端 API 编码，本地不跑模型） | `/api/semantic`、`/api/similar` |

⚠️ 建库与查询使用**同一个云端模型**，否则向量空间不一致、检索无效。

---

## 一、服务器端（已完成）

```bash
# 导出全量建库数据（77 万词条，含 word + 中英文释义 + 词频）
python3 vector/export_data.py
# 输出：data/vector_input.jsonl
```

查询 API 已就绪（`/dict/api/semantic`、`/dict/api/similar`），
在向量库与 API 配置就绪前返回 503 提示。

## 二、你的设备上建库

### 1. 准备

- 拿到 `data/vector_input.jsonl`（与代码一并拷贝过去）
- Python 3.9+，`pip install -r vector/requirements.txt`（仅 sqlite-vec，**无需任何本地模型**）

### 2. 配置云端 Embedding API

把 `vector/embed_config.example.json` 复制为 `data/embed_config.json`，
填写你的 API 服务商信息：

```json
{
    "base_url": "https://api.openai.com/v1",
    "model": "text-embedding-3-small",
    "dimensions": null,
    "api_key": "sk-xxx（或设置环境变量 EMBED_API_KEY）",
    "batch_size": 32
}
```

`base_url` 为 OpenAI 兼容的 `/embeddings` 接口地址（OpenAI / 智谱 / DashScope / vLLM 等均可）。

### 3. 建库

```bash
# 推荐先建常用子集（frq>0，约 4.4 万条，费用低、速度快，用于验证链路）
python vector/build_vectors.py data/vector_input.jsonl data/vectors_common.db --min-frq 1

# 再建全量（77 万条，API 调用次数 = 词条数 / batch_size，注意费用）
python vector/build_vectors.py data/vector_input.jsonl data/vectors.db
```

### 4. 回传

把生成的 `vectors_common.db`（和/或 `vectors.db`）拷回服务器
`/home/deploy/code/wordsearch/data/` 目录，查询 API 自动启用
（`vectors_common.db` 优先）。

## 三、查询 API

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

## 四、注意事项

- 向量库大小：全量 77 万 × 模型维度 × 4B（如 1536 维 ≈ 4.7GB）；常用子集约 270MB
- 服务器内存有限（1.7GB）：推荐常用子集；全量库查询会占用更多内存
- API key 存于 `data/embed_config.json`（已 gitignore），也可用环境变量 `EMBED_API_KEY` 覆盖
- 换模型后必须重新建库（旧向量库与新查询向量不兼容）
