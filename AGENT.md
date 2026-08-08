# AGENT.md · 智能中英词典（wordsearch）开发交接

基于 ECDICT 开源词库的中英词典 Web 应用：英文关键词/模糊搜索、中文释义反向查询、
向量化语义搜索（描述 → 单词）、同近义词推荐。

**线上地址**：`https://www.stringandstick.cn/dict/`
**技术形态**：FastAPI + SQLite（FTS5）+ sqlite-vec 向量检索；云端 Embedding API（本地不跑模型）

---

## 1. 目录结构

```
wordsearch/
├── main.py                  # FastAPI 入口：/api/search /api/suggest /api/semantic /api/similar + 静态托管
├── config.py                # 路径与搜索参数（limit、编辑距离阈值等）
├── build_db.py              # ecdict.csv -> ecdict.db（stardict + FTS5 trigram）
├── backend/
│   ├── search.py            # 关键词搜索：英文精确/前缀/编辑距离≤2；中文 FTS5 反向，frq 排序
│   ├── suggest.py           # 自动补全：英文前缀 / 中文释义前缀
│   ├── database.py          # SQLite 连接（每请求独立连接，PRAGMA query_only）
│   └── models.py            # Pydantic 响应模型
├── vector/
│   ├── semantic_search.py   # 服务器查询端：云端编码 + sqlite-vec kNN
│   ├── embed_api.py         # 云端 Embedding API 客户端（OpenAI 兼容，base64）
│   ├── export_data.py       # ecdict.db -> vector_input.jsonl（77 万词条，已在服务器生成）
│   ├── build_vectors.py     # 建库脚本（在【用户其他设备】上运行，用户手动维护，勿改）
│   └── README.md            # 向量库 schema 约定与分工说明（改查询逻辑时需同步）
├── static/                  # 当前词典前端（index.html / app.js / style.css），FastAPI 直出磁盘
├── data/                    # 数据库与密钥（均 gitignore）
│   ├── ecdict.db            # 主词典库（含 FTS5 索引）
│   ├── vectors_common.db    # 常用词向量子集（4.2 万条，用户回传，查询端优先使用）
│   └── embed_config.json    # 嵌入 API 配置（权限 600，勿提交，内容勿外泄）
└── requirements.txt         # fastapi / uvicorn[standard]
```

## 2. 数据格式（重要约定）

### 2.1 字面 `\n` 的坑（曾踩过）

ECDICT CSV 中的换行以**字面 `\n`（反斜杠+n 两个字符）**存储，非真实换行符。
数据库中 `translation`/`definition`/向量库 `text` 字段混有两种格式（真实换行 + 字面 `\n`）。

**渲染层必须在拆分行前归一化**：`String(text).replace(/\\n/g, '\n')` 再 `split('\n')`。
已修复位置（勿回退）：
- 前端 `static/app.js` `interpLines()`（唯一渲染入口，覆盖详情卡/反向列表/语义列表）
- 后端 `backend/search.py` `parse_text_list()`、`backend/suggest.py` `_hint()`

注意：向量库 `text` 字段由用户本机生成后直接透传，**未经后端归一化**，
新增任何消费 `text` 的路径都必须先处理字面 `\n`。

### 2.2 主词典库 ecdict.db

`stardict` 表：`word`（主键）、`sw`（小写）、`phonetic`、`definition`、`translation`、
`pos`、`collins`、`oxford`、`tag`、`bnc`、`frq`、`exchange`、`detail`。
`stardict_fts`：FTS5 trigram 虚拟表（content 外联 + 增删改触发器），中文子串匹配依赖它。

### 2.3 向量库（schema 详见 vector/README.md）

- `vec_entries`：`vec0(embedding float[1024])` 虚拟表
- `meta`：`id`（=vec_entries.rowid，从 1 起）、`word`、`text`、`frq`、`collins`、`oxford`、`bnc`、`tag`
- 向量 float32、L2 归一化；查询端从 `float[N]` 表定义探测维度

## 3. API 一览（均在 /dict 前缀下）

| 接口 | 说明 | 备注 |
|------|------|------|
| `GET /api/search?q=&limit=&offset=` | 关键词搜索（英文/中文自动识别） | 响应含 `results[].{word, phonetic, definition[], translation[], pos, collins, oxford, tag, bnc, frq, exchange}`；definition/translation 为**行数组** |
| `GET /api/suggest?q=&limit=` | 自动补全 | `{word, hint}` |
| `GET /api/semantic?q=&limit=` | 语义搜索（描述 → 单词） | 向量库/API 未就绪返回 503 `{error}`；`results[].distance` 为余弦距离 0~2，前端相似度 = 100×(1−dist/2) |
| `GET /api/similar?word=&limit=` | 同近义词（排除自身） | 同上 |

## 4. 向量化方案现状

- **分工**：数据导出在服务器完成；建库在用户其他设备运行（bge-m3 / 1024 维）；查询走云端 API。
- **查询链路**：云端 bge-m3 编码（华为云 ModelArts MaaS，`data/embed_config.json` 配置，
  也可用环境变量 `EMBED_API_KEY` 覆盖）→ 本地 sqlite-vec 暴力 kNN，延迟约 0.4s。
- **库优先级**：`vectors_common.db`（4.2 万常用词）优先于 `vectors.db`（全量，未回传）；
  `_ensure_ready()` 每次初始化前重新探测，向量库回传晚于进程启动也能自动生效，**无需重启**。
- **并发安全**：`sqlite3.connect(check_same_thread=False)` + 单锁串行化 kNN；
  初始化（连接/维度探测/client）全在锁内，改代码时勿破坏此约束（曾修过提前 return 跳过 client 初始化的竞态）。
- **内存限制**：服务器 2 核 / 1.7GB（可用约 660MB）。全量库 77 万 × 1024 × 4B ≈ 3.1GB，
  **不可在本服务器查询全量库**，线上固定用常用子集。

## 5. 部署与运维

- **nginx**：`/etc/nginx/sites-enabled/stringandstick.conf`，`location /dict/` → `http://127.0.0.1:3015/`
- **pm2**：进程 `dict-web`（id 11），**必须用 deploy 用户操作**：
  ```bash
  su - deploy -c 'pm2 status dict-web'
  su - deploy -c 'pm2 restart dict-web'
  su - deploy -c 'pm2 logs dict-web'
  ```
  启动方式（勿改用 `uvicorn` 可执行文件）：
  `.venv/bin/python -m uvicorn main:app --host 127.0.0.1 --port 3015`
- **开发环境**：直接 `python main.py` 即可（`config.py` 默认 `0.0.0.0:3000`，
  可用环境变量 `DICT_HOST` / `DICT_PORT` 覆盖；pm2 生产端口 3015 由命令行显式指定，不受影响）
- **静态文件**由 FastAPI StaticFiles 直出磁盘，改 `static/` 下文件**无需重启服务**，
  浏览器强刷（Ctrl/Cmd+Shift+R）即可。
- **改后端**后需重启：`su - deploy -c 'cd /home/deploy/code/wordsearch && pm2 restart dict-web --update-env'`
- 改 nginx 配置前先备份，改后 `nginx -t && systemctl reload nginx`。

## 6. 常用开发命令

```bash
cd /home/deploy/code/wordsearch
.venv/bin/python -m uvicorn main:app --host 127.0.0.1 --port 3015  # 本地起服务（用 .venv）

# 验证
curl -s 'http://127.0.0.1:3015/api/search?q=happy'
curl -s 'http://127.0.0.1:3015/api/semantic?q=开心'
node --check static/app.js
.venv/bin/python -c "import ast; ast.parse(open('backend/search.py').read())"
```

## 7. 已知事项 / 待办

- [ ] 全量向量库 `vectors.db`（77 万条）仍在用户本机建库，回传后**无需改代码**
      （仅用于归档/其他用途；本服务器内存不足以查询全量库）
- [ ] 前端未在真实浏览器全面回归（曾由用户实测发现 interpLines 类型错误并修复）；
      若报前端问题，优先检查 `app.js` 渲染路径的数据形状
- [ ] 词形变化、发音按钮等依赖有道公开接口，失效需降级处理
- [ ] git 提交遵循现有 `feat:` / `fix:` 前缀风格；未经用户要求不要主动 commit/push
