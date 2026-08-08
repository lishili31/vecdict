# -*- coding: utf-8 -*-
"""API 数据模型"""
from typing import Any, Dict, List, Optional

from pydantic import BaseModel


class DictEntry(BaseModel):
    """单条词条"""

    word: str
    phonetic: str = ""
    pos: str = ""
    definition: List[str] = []
    translation: List[str] = []
    collins: int = 0
    oxford: int = 0
    tag: str = ""
    bnc: int = 0
    frq: int = 0
    exchange: Dict[str, Any] = {}


class SearchResponse(BaseModel):
    query: str
    total: int
    offset: int
    results: List[DictEntry]


class SuggestItem(BaseModel):
    word: str
    hint: str = ""


class SuggestResponse(BaseModel):
    prefix: str
    suggestions: List[SuggestItem]
