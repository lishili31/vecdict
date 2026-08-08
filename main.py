# -*- coding: utf-8 -*-
"""智能中英词典 · FastAPI 入口（关键词匹配版，ECDICT 词库）"""
from fastapi import FastAPI, Query
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from backend import search as search_mod
from backend import suggest as suggest_mod
from backend.database import get_connection
from backend.models import SearchResponse, SuggestResponse
from config import DEFAULT_LIMIT, DEFAULT_SUGGEST_LIMIT, MAX_LIMIT, MAX_SUGGEST_LIMIT, STATIC_DIR
from vector.semantic_search import SemanticSearchError, get_searcher

app = FastAPI(
    title="智能中英词典",
    description="基于 ECDICT 词库的关键词匹配中英词典：英文前缀/模糊搜索、中文释义反向搜索、自动补全",
    version="0.1.0",
)


@app.get("/api/search", response_model=SearchResponse)
def api_search(
    q: str = Query(..., min_length=1, description="搜索关键词（英文/中文）"),
    limit: int = Query(DEFAULT_LIMIT, ge=1, le=MAX_LIMIT),
    offset: int = Query(0, ge=0),
):
    conn = get_connection()
    try:
        total, results = search_mod.search(conn, q, limit, offset)
    finally:
        conn.close()
    return SearchResponse(query=q, total=total, offset=offset, results=results)


@app.get("/api/suggest", response_model=SuggestResponse)
def api_suggest(
    q: str = Query(..., min_length=1, description="补全前缀"),
    limit: int = Query(DEFAULT_SUGGEST_LIMIT, ge=1, le=MAX_SUGGEST_LIMIT),
):
    conn = get_connection()
    try:
        suggestions = suggest_mod.suggest(conn, q, limit)
    finally:
        conn.close()
    return SuggestResponse(prefix=q, suggestions=suggestions)


def _semantic_guard():
    """向量搜索前置检查：返回错误响应或 None"""
    try:
        get_searcher()
    except SemanticSearchError as e:
        return JSONResponse(status_code=503, content={"error": str(e)})
    return None


@app.get("/api/semantic")
def api_semantic(
    q: str = Query(..., min_length=1, description="中文/英文描述，返回语义相近词条"),
    limit: int = Query(10, ge=1, le=50),
):
    """语义搜索（反向词典）：描述 -> 相关英文单词（向量检索）"""
    guard = _semantic_guard()
    if guard:
        return guard
    try:
        results = get_searcher().search(q, limit)
    except SemanticSearchError as e:
        return JSONResponse(status_code=503, content={"error": str(e)})
    return {"query": q, "results": results}


@app.get("/api/similar")
def api_similar(
    word: str = Query(..., min_length=1, description="英文单词"),
    limit: int = Query(10, ge=1, le=50),
):
    """同近义词推荐：与目标单词语义最相近的词条（向量检索）"""
    guard = _semantic_guard()
    if guard:
        return guard
    try:
        results = get_searcher().similar(word, limit)
    except SemanticSearchError as e:
        return JSONResponse(status_code=503, content={"error": str(e)})
    return {"word": word, "results": results}


@app.get("/", include_in_schema=False)
def index():
    return FileResponse(STATIC_DIR / "index.html")


# 静态资源（API 路由已优先注册）
app.mount("/", StaticFiles(directory=str(STATIC_DIR)), name="static")
