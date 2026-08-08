# -*- coding: utf-8 -*-
"""词典应用配置"""
from pathlib import Path

ROOT = Path(__file__).resolve().parent
DB_PATH = ROOT / "data" / "ecdict.db"
STATIC_DIR = ROOT / "static"

DEFAULT_LIMIT = 20
MAX_LIMIT = 100
DEFAULT_SUGGEST_LIMIT = 10
MAX_SUGGEST_LIMIT = 20

# 模糊匹配（编辑距离）允许的最大距离
MAX_EDIT_DISTANCE = 2
# 模糊匹配候选前缀取词长度（用于覆盖拼写错误场景）
FUZZY_PREFIX_LEN = 3
