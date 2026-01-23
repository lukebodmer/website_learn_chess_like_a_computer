"""
Abstract Base Classes for LLM Clients

Defines the interface that all LLM clients must implement, ensuring
consistency and ease of swapping between different LLM providers.
"""

from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import Optional, Dict, Any
from enum import Enum


class LLMProvider(Enum):
    """Supported LLM providers"""
    DEEPSEEK = "deepseek"
    OPENAI = "openai"
    ANTHROPIC = "anthropic"
    # Add more as needed


@dataclass
class LLMResponse:
    """
    Standardized response from an LLM client

    Attributes:
        success: Whether the request was successful
        content: The generated text content
        error: Error message if request failed
        tokens_used: Number of tokens consumed (if available)
        metadata: Additional provider-specific metadata
    """
    success: bool
    content: str
    error: Optional[str] = None
    tokens_used: Optional[int] = None
    metadata: Optional[Dict[str, Any]] = None


class LLMClient(ABC):
    """
    Abstract base class for LLM clients

    All LLM providers must implement this interface to ensure
    consistent behavior across the application.
    """

    def __init__(self, api_key: str, model: Optional[str] = None, **kwargs):
        """
        Initialize the LLM client

        Args:
            api_key: API key for the LLM provider
            model: Model name/identifier (provider-specific)
            **kwargs: Additional provider-specific configuration
        """
        self.api_key = api_key
        self.model = model
        self.config = kwargs

    @abstractmethod
    def generate(
        self,
        prompt: str,
        system_prompt: Optional[str] = None,
        temperature: float = 0.7,
        max_tokens: Optional[int] = None,
        **kwargs
    ) -> LLMResponse:
        """
        Generate text based on the provided prompt

        Args:
            prompt: The user prompt/query
            system_prompt: System-level instructions for the LLM
            temperature: Sampling temperature (0.0 - 1.0)
            max_tokens: Maximum tokens to generate
            **kwargs: Provider-specific parameters

        Returns:
            LLMResponse object containing the generated text and metadata
        """
        pass

    @abstractmethod
    def validate_connection(self) -> bool:
        """
        Validate that the client can connect to the LLM provider

        Returns:
            True if connection is valid, False otherwise
        """
        pass

    @property
    @abstractmethod
    def provider(self) -> LLMProvider:
        """Return the provider type for this client"""
        pass

    def __repr__(self) -> str:
        return f"{self.__class__.__name__}(provider={self.provider.value}, model={self.model})"
