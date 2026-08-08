# -*- coding: utf-8 -*-
"""词典应用配置"""
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parent
DB_PATH = ROOT / "data" / "ecdict.db"
STATIC_DIR = ROOT / "static"

# 服务监听配置：默认 0.0.0.0:3000，可用环境变量 DICT_HOST / DICT_PORT 覆盖
# （pm2 / 生产部署通过命令行显式指定端口，不受此处影响）
HOST = os.environ.get("DICT_HOST", "0.0.0.0")
PORT = int(os.environ.get("DICT_PORT", "3000"))

DEFAULT_LIMIT = 20
MAX_LIMIT = 100
DEFAULT_SUGGEST_LIMIT = 10
MAX_SUGGEST_LIMIT = 20

# 模糊匹配（编辑距离）允许的最大距离
MAX_EDIT_DISTANCE = 2
# 模糊匹配候选前缀取词长度（用于覆盖拼写错误场景）
FUZZY_PREFIX_LEN = 3
