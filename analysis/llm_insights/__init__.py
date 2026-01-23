"""
LLM Insights Module

A modular, object-oriented system for generating AI-powered insights from chess game data.

This module provides:
- Abstract base classes for LLM clients
- Concrete implementations for different LLM providers (DeepSeek, etc.)
- Data analyzers for extracting structured data from game reports
- Prompt templates for generating insightful summaries
- Integration layer for seamless backend/frontend communication
"""

from .llm_client import LLMClient, LLMResponse
from .deepseek_client import DeepSeekClient
from .game_results_analyzer import GameResultsAnalyzer
from .mistakes_analyzer import MistakesAnalyzer
from .blunder_analyzer import BlunderAnalyzer
from .time_analyzer import TimeAnalyzer
from .insights_generator import InsightsGenerator

__all__ = [
    'LLMClient',
    'LLMResponse',
    'DeepSeekClient',
    'GameResultsAnalyzer',
    'MistakesAnalyzer',
    'BlunderAnalyzer',
    'TimeAnalyzer',
    'InsightsGenerator',
]
