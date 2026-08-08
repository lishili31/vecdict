# -*- coding: utf-8 -*-
"""SQLite 数据库连接管理"""
import sqlite3

from config import DB_PATH

# SQLite 连接在 FastAPI 多线程下使用：每个请求独立连接，避免线程共享
def get_connection() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA query_only=ON")
    return conn
