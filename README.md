# 智能中英词典 (Smart Bilingual Dictionary)

基于 [ECDICT](https://github.com/skywind3000/ECDICT) 开源词库的中英词典 Web 应用。
支持英文关键词/模糊搜索、中文释义反向查询、自动补全，并通过 **向量化模型** 提供
语义搜索（用描述找单词）与同近义词推荐。

> 🖥️ **在线体验**：<https://www.stringandstick.cn/dict/>

## 功能特性

- 🔍 **关键词搜索**：英文精确匹配、前缀匹配、编辑距离 ≤2 的拼写纠错；按词频/柯林斯星级排序
- 🇨🇳 **中文反向查询**：FTS5 trigram 索引，在 77 万词条的中文释义中查找匹配单词
- 🧠 **语义搜索**：输入中文或英文描述（如「形容坚持不懈」），返回语义最接近的单词
- 🔗 **同近义词推荐**：基于词向量余弦相似度推荐近义词，附相似度百分比
- ✨ **自动补全**：英文前缀 / 中文释义前缀联想
- 🔊 **发音**：美音 / 英音（有道词典公开接口）
- 📱 响应式布局，适配移动端；自动跟随系统深浅色主题

## 技术架构

```
浏览器 (static/)
    │  HTTP
    ▼
FastAPI (main.py)
    ├── /api/search     ──►  SQLite + FTS5 (ecdict.db, 77 万词条)
    ├── /api/suggest    ──►  SQLite 前缀查询
    ├── /api/semantic   ──►  云端 Embedding API → sqlite-vec kNN
    └── /api/similar    ──►  云端 Embedding API → sqlite-vec kNN
```

- **关键词检索**：Python 标准库 + SQLite（FTS5 trigram），零第三方运行时依赖
- **向量检索**：查询文本通过云端 Embedding API（OpenAI 兼容，bge-m3 / 1024 维）编码，
  本地仅做 sqlite-vec 暴力 kNN，无需 GPU / 本地模型

## 快速开始

### 1. 准备词库

下载 [ECDICT 词库 CSV](https://github.com/skywind3000/ECDICT) 放入 `data/ecdict.csv`，然后建库：

```bash
python build_db.py          # 生成 data/ecdict.db（含 FTS5 索引）
```

> 建库脚本依赖 SQLite 的 FTS5 trigram 支持（Python 3.11+ 内置 sqlite3 通常已启用；
> 3.9/3.10 需确认）。

### 2. 启动服务

服务默认监听 `0.0.0.0:3000`，端口可通过环境变量 `DICT_PORT` 自定义（如 `DICT_PORT=8080 python main.py`）：

```bash
pip install -r requirements.txt
python main.py              # 或 uvicorn main:app --host 0.0.0.0 --port 3000
```

打开 http://localhost:3000 即可使用关键词搜索。

### 3.（可选）启用向量语义搜索

语义搜索需要向量库与嵌入 API：

1. **配置云端嵌入 API**：参照 `vector/embed_config.example.json` 创建 `data/embed_config.json`
   （bge-m3 / 1024 维，支持 OpenAI 兼容的 `/embeddings` 接口），
   或设置环境变量 `EMBED_API_KEY`
2. **生成向量库**（可在任意设备执行）：
   ```bash
   cd vector && pip install -r requirements.txt
   python export_data.py        # ecdict.db → data/vector_input.jsonl
   python build_vectors.py      # 生成 sqlite-vec 向量库，放入 data/
   ```
   向量库格式约定见 [vector/README.md](vector/README.md)
3. 重启服务后，`/api/semantic`、`/api/similar` 自动启用；向量库缺失时返回 503 提示

> ⚠️ 建库与查询必须使用**同一个模型**（bge-m3），否则向量空间不一致、检索无效。

## API

| 接口 | 说明 |
|------|------|
| `GET /api/search?q=happy&limit=20&offset=0` | 关键词搜索（自动识别中英文） |
| `GET /api/suggest?q=ha&limit=10` | 自动补全 |
| `GET /api/semantic?q=形容坚持不懈&limit=10` | 语义搜索：描述 → 相关单词 |
| `GET /api/similar?word=happy&limit=10` | 同近义词推荐 |

## 目录结构

```
├── main.py                  # FastAPI 入口与路由
├── build_db.py              # ECDICT CSV → SQLite（FTS5 索引）
├── backend/                 # 关键词搜索、自动补全、数据库连接
├── vector/                  # 向量化：导出、建库（其他设备运行）、查询端、嵌入 API 客户端
├── static/                  # 前端页面
├── data/                    # 数据库、向量库、嵌入 API 配置（gitignore，不入库）
```

## 部署参考

生产环境可通过 nginx 反代到 uvicorn，并用 pm2 / systemd 托管进程，例如：

```nginx
location /dict/ {
    proxy_pass http://127.0.0.1:3015/;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}
```

## 致谢

- [ECDICT](https://github.com/skywind3000/ECDICT) — 开源英汉词典数据（77 万词条）
- [sqlite-vec](https://github.com/asg017/sqlite-vec) — SQLite 向量检索扩展
- [BGE-M3](https://github.com/FlagOpen/FlagEmbedding) — 多语言嵌入模型
- 发音接口来自有道词典公开接口

## 许可证

[MIT](LICENSE)
