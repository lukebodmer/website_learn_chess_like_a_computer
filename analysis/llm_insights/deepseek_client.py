"""
DeepSeek LLM Client Implementation

Concrete implementation of the LLM client for DeepSeek's API.
"""

import requests
import logging
from typing import Optional, Dict, Any
from .llm_client import LLMClient, LLMResponse, LLMProvider


logger = logging.getLogger(__name__)


class DeepSeekClient(LLMClient):
    """
    Client for interacting with DeepSeek's API

    DeepSeek provides high-quality, cost-effective language models
    suitable for generating chess insights and analysis.
    """

    DEFAULT_MODEL = "deepseek-chat"
    API_BASE_URL = "https://api.deepseek.com/v1"

    def __init__(
        self,
        api_key: str,
        model: Optional[str] = None,
        timeout: int = 30,
        **kwargs
    ):
        """
        Initialize the DeepSeek client

        Args:
            api_key: DeepSeek API key
            model: Model name (defaults to deepseek-chat)
            timeout: Request timeout in seconds
            **kwargs: Additional configuration options
        """
        super().__init__(
            api_key=api_key,
            model=model or self.DEFAULT_MODEL,
            timeout=timeout,
            **kwargs
        )
        self.timeout = timeout
        self.base_url = kwargs.get('base_url', self.API_BASE_URL)

    @property
    def provider(self) -> LLMProvider:
        """Return the provider type"""
        return LLMProvider.DEEPSEEK

    def generate(
        self,
        prompt: str,
        system_prompt: Optional[str] = None,
        temperature: float = 0.7,
        max_tokens: Optional[int] = None,
        **kwargs
    ) -> LLMResponse:
        """
        Generate text using DeepSeek's API

        Args:
            prompt: The user prompt/query
            system_prompt: System-level instructions
            temperature: Sampling temperature (0.0 - 1.0)
            max_tokens: Maximum tokens to generate
            **kwargs: Additional DeepSeek-specific parameters

        Returns:
            LLMResponse with generated content
        """
        try:
            # Build messages array
            messages = []
            if system_prompt:
                messages.append({
                    "role": "system",
                    "content": system_prompt
                })
            messages.append({
                "role": "user",
                "content": prompt
            })

            # Prepare request payload
            payload = {
                "model": self.model,
                "messages": messages,
                "temperature": temperature,
            }

            if max_tokens:
                payload["max_tokens"] = max_tokens

            # Add any additional parameters
            payload.update(kwargs)

            # Make API request
            headers = {
                "Authorization": f"Bearer {self.api_key}",
                "Content-Type": "application/json"
            }

            response = requests.post(
                f"{self.base_url}/chat/completions",
                json=payload,
                headers=headers,
                timeout=self.timeout
            )

            response.raise_for_status()
            data = response.json()

            # Extract content from response
            if "choices" in data and len(data["choices"]) > 0:
                content = data["choices"][0]["message"]["content"]
                tokens_used = data.get("usage", {}).get("total_tokens")

                return LLMResponse(
                    success=True,
                    content=content,
                    tokens_used=tokens_used,
                    metadata={
                        "model": self.model,
                        "finish_reason": data["choices"][0].get("finish_reason"),
                        "usage": data.get("usage", {})
                    }
                )
            else:
                logger.error(f"Unexpected response format from DeepSeek: {data}")
                return LLMResponse(
                    success=False,
                    content="",
                    error="Unexpected response format from API"
                )

        except requests.exceptions.Timeout:
            logger.error(f"DeepSeek API request timed out after {self.timeout}s")
            return LLMResponse(
                success=False,
                content="",
                error=f"Request timed out after {self.timeout} seconds"
            )

        except requests.exceptions.HTTPError as e:
            logger.error(f"DeepSeek API HTTP error: {e}")
            error_msg = f"HTTP {e.response.status_code}"
            try:
                error_data = e.response.json()
                error_msg = error_data.get("error", {}).get("message", error_msg)
            except:
                pass

            return LLMResponse(
                success=False,
                content="",
                error=error_msg
            )

        except Exception as e:
            logger.error(f"Unexpected error calling DeepSeek API: {e}")
            return LLMResponse(
                success=False,
                content="",
                error=str(e)
            )

    def validate_connection(self) -> bool:
        """
        Validate connection to DeepSeek API

        Returns:
            True if connection is valid, False otherwise
        """
        try:
            # Make a minimal test request
            response = self.generate(
                prompt="Hello",
                max_tokens=5,
                temperature=0
            )
            return response.success

        except Exception as e:
            logger.error(f"Connection validation failed: {e}")
            return False

    def estimate_tokens(self, text: str) -> int:
        """
        Rough estimation of tokens for a given text

        Note: This is a rough approximation. For accurate token counting,
        use the actual tokenizer for the model.

        Args:
            text: Input text to estimate

        Returns:
            Estimated token count
        """
        # Rough approximation: 1 token ≈ 4 characters for English text
        return len(text) // 4

    def calculate_cost(
        self,
        input_tokens: int,
        output_tokens: int,
        model: Optional[str] = None
    ) -> float:
        """
        Calculate estimated cost for a request

        Args:
            input_tokens: Number of input tokens
            output_tokens: Number of output tokens
            model: Model name (uses instance model if not provided)

        Returns:
            Estimated cost in USD
        """
        # DeepSeek pricing (as of implementation)
        # These rates should be updated based on current pricing
        pricing = {
            "deepseek-chat": {
                "input": 0.00014 / 1000,   # $0.14 per 1M tokens
                "output": 0.00028 / 1000,  # $0.28 per 1M tokens
            },
            "deepseek-reasoner": {
                "input": 0.00055 / 1000,   # $0.55 per 1M tokens
                "output": 0.0022 / 1000,   # $2.19 per 1M tokens
            }
        }

        model_name = model or self.model
        rates = pricing.get(model_name, pricing["deepseek-chat"])

        input_cost = input_tokens * rates["input"]
        output_cost = output_tokens * rates["output"]

        return input_cost + output_cost
