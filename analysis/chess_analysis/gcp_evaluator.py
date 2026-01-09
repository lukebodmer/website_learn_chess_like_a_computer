"""
GCP Stockfish API Client

This module provides a client for communicating with the GCP-hosted Stockfish
evaluation API from the main Digital Ocean application.
"""

import requests
import time
import logging
import subprocess
from typing import List, Dict, Optional
from django.conf import settings

logger = logging.getLogger(__name__)

class GCPStockfishClient:
    """Client for GCP Stockfish evaluation service"""

    def __init__(self, base_url: Optional[str] = None):
        """
        Initialize GCP client

        Args:
            base_url: GCP service URL (defaults to settings.GCP_STOCKFISH_URL)
        """
        self.base_url = (base_url or getattr(settings, 'GCP_STOCKFISH_URL', None))
        if not self.base_url:
            raise ValueError("GCP_STOCKFISH_URL not configured in settings")

        self.base_url = self.base_url.rstrip('/')

        # Configure HTTP session
        self.session = requests.Session()
        self.session.headers.update({
            'Content-Type': 'application/json',
            'User-Agent': 'ChessAnalysis-DigitalOcean/1.0'
        })

        # Get authentication token
        self.auth_token = self._get_auth_token()

        # Timeouts and retries (increased for memory-optimized API)
        self.timeout = 600  # 10 minutes for large batches (doubled due to memory optimizations)
        self.max_retries = 3

        logger.info(f"Initialized GCP Stockfish client for {self.base_url}")

    def _get_auth_token(self) -> Optional[str]:
        """
        Get GCP authentication token using gcloud command

        Returns:
            Bearer token string or None if failed
        """
        try:
            result = subprocess.run(
                ['gcloud', 'auth', 'print-identity-token'],
                capture_output=True,
                text=True,
                timeout=30
            )

            if result.returncode == 0:
                token = result.stdout.strip()
                logger.info("Successfully obtained GCP auth token")
                return token
            else:
                logger.error(f"Failed to get GCP auth token: {result.stderr}")
                return None

        except Exception as e:
            logger.error(f"Error getting GCP auth token: {e}")
            return None

    def _get_auth_headers(self) -> Dict[str, str]:
        """Get headers with authentication"""
        headers = {}
        if self.auth_token:
            headers['Authorization'] = f'Bearer {self.auth_token}'
        return headers

    def health_check(self) -> bool:
        """
        Check if GCP service is healthy

        Returns:
            True if service is healthy, False otherwise
        """
        try:
            response = self.session.get(
                f"{self.base_url}/health",
                headers=self._get_auth_headers(),
                timeout=10
            )
            response.raise_for_status()

            data = response.json()
            is_healthy = data.get('status') == 'healthy'

            if is_healthy:
                logger.info(f"GCP service healthy: {data.get('workers', 'unknown')} workers")
            else:
                logger.warning(f"GCP service unhealthy: {data}")

            return is_healthy

        except Exception as e:
            logger.error(f"GCP health check failed: {e}")
            return False

    def evaluate_single_position_async(
        self,
        position: str,
        depth: int = 20
    ) -> Dict[str, Dict]:
        """
        Send a single position to GCP for evaluation

        Args:
            position: FEN string to evaluate
            depth: Stockfish search depth

        Returns:
            Dict with single position result
        """
        return self.evaluate_positions_batch([position], depth)

    def evaluate_positions_batch(
        self,
        positions: List[str],
        depth: int = 20
    ) -> Dict[str, Dict]:
        """
        Send positions to GCP for batch evaluation

        Args:
            positions: List of FEN strings to evaluate
            depth: Stockfish search depth (default: 20)

        Returns:
            Dict mapping FEN to evaluation result

        Raises:
            requests.RequestException: If API call fails
            ValueError: If response format is invalid
        """
        if not positions:
            return {}

        if len(positions) > 1000:
            raise ValueError(f"Too many positions: {len(positions)} (max 1000)")

        payload = {
            "positions": positions,
            "depth": depth
        }

        logger.info(f"Sending {len(positions)} positions to GCP (depth={depth})")
        print(f"🔥 DEBUG: Making GCP API call with {len(positions)} positions")
        start_time = time.time()

        last_exception = None

        # Retry logic with longer waits for concurrent requests
        for attempt in range(self.max_retries):
            print(f"🔥 DEBUG: API attempt {attempt + 1}/{self.max_retries}")
            try:
                # Refresh auth token on retries to handle expiration
                if attempt > 0:
                    logger.info(f"Refreshing auth token for retry attempt {attempt + 1}")
                    self.auth_token = self._get_auth_token()

                response = self.session.post(
                    f"{self.base_url}/evaluate",
                    json=payload,
                    headers=self._get_auth_headers(),
                    timeout=self.timeout
                )
                response.raise_for_status()

                data = response.json()
                elapsed = time.time() - start_time

                # Validate response structure
                if 'results' not in data or 'metadata' not in data:
                    raise ValueError(f"Invalid response format: {data}")

                metadata = data['metadata']
                logger.info(
                    f"GCP evaluation complete in {elapsed:.2f}s - "
                    f"Success: {metadata.get('successful_evaluations', 0)}, "
                    f"Failed: {metadata.get('failed_evaluations', 0)}"
                )
                print(f"✅ DEBUG: API call SUCCESS in {elapsed:.2f}s - {metadata.get('successful_evaluations', 0)} evals")

                return data["results"]

            except requests.exceptions.HTTPError as e:
                last_exception = e
                status_code = e.response.status_code if e.response else None

                if status_code == 503:
                    # Service temporarily unavailable - longer wait for cold start
                    wait_time = (2 ** attempt) + 10  # Extra time for GCP to spin up
                    logger.warning(f"GCP service unavailable (503), waiting {wait_time}s for cold start...")
                    print(f"❌ DEBUG: API call FAILED with 503 - waiting {wait_time}s for cold start")
                elif status_code == 500:
                    # Internal server error - medium wait
                    wait_time = (2 ** attempt) + 5
                    logger.warning(f"GCP internal error (500), retrying in {wait_time}s...")
                    print(f"❌ DEBUG: API call FAILED with 500 - retrying in {wait_time}s")
                elif status_code == 403:
                    # Auth error - refresh token immediately
                    logger.warning("Auth error (403), refreshing token...")
                    print(f"❌ DEBUG: API call FAILED with 403 - refreshing auth token")
                    self.auth_token = self._get_auth_token()
                    wait_time = 1
                else:
                    wait_time = 2 ** attempt
                    logger.warning(f"GCP HTTP error {status_code}, retrying in {wait_time}s: {e}")
                    print(f"❌ DEBUG: API call FAILED with {status_code} - retrying in {wait_time}s")

                if attempt < self.max_retries - 1:
                    time.sleep(wait_time)
                else:
                    logger.error(f"All {self.max_retries} GCP API attempts failed")

            except requests.exceptions.RequestException as e:
                last_exception = e
                if attempt < self.max_retries - 1:
                    wait_time = 2 ** attempt
                    logger.warning(f"GCP API attempt {attempt + 1} failed, retrying in {wait_time}s: {e}")
                    time.sleep(wait_time)
                else:
                    logger.error(f"All {self.max_retries} GCP API attempts failed")
            except Exception as e:
                logger.error(f"GCP evaluation error: {e}")
                raise

        # If we get here, all retries failed - return empty results instead of crashing
        logger.error(f"GCP API completely failed after {self.max_retries} attempts: {last_exception}")

        # Return error markers for all positions instead of crashing the whole analysis
        error_results = {}
        for fen in positions:
            error_results[fen] = {"error": f"GCP API failed: {str(last_exception)}"}

        return error_results

    def evaluate_positions_chunked(
        self,
        positions: List[str],
        depth: int = 20,
        chunk_size: int = 500
    ) -> Dict[str, Dict]:
        """
        Evaluate positions in chunks for very large batches

        Args:
            positions: List of FEN strings to evaluate
            depth: Stockfish search depth
            chunk_size: Number of positions per API call

        Returns:
            Combined dict mapping FEN to evaluation result
        """
        if not positions:
            return {}

        if len(positions) <= chunk_size:
            return self.evaluate_positions_batch(positions, depth)

        logger.info(f"Chunking {len(positions)} positions into groups of {chunk_size}")

        all_results = {}
        total_chunks = (len(positions) + chunk_size - 1) // chunk_size

        for i in range(0, len(positions), chunk_size):
            chunk = positions[i:i + chunk_size]
            chunk_num = (i // chunk_size) + 1

            logger.info(f"Processing chunk {chunk_num}/{total_chunks} ({len(chunk)} positions)")

            try:
                chunk_results = self.evaluate_positions_batch(chunk, depth)
                all_results.update(chunk_results)

            except Exception as e:
                logger.error(f"Chunk {chunk_num} failed: {e}")
                # Continue with other chunks, mark failed positions
                for fen in chunk:
                    all_results[fen] = {"error": f"Chunk evaluation failed: {str(e)}"}

        success_count = len([r for r in all_results.values() if "error" not in r])
        logger.info(f"Chunked evaluation complete: {success_count}/{len(positions)} successful")

        return all_results

    def evaluate_positions_parallel_streaming(
        self,
        positions: List[str],
        depth: int = 20,
        max_concurrent: int = 20
    ):
        """
        Generator that evaluates positions in parallel and yields individual completions

        Args:
            positions: List of FEN strings to evaluate
            depth: Stockfish search depth
            max_concurrent: Maximum number of concurrent requests

        Yields:
            Individual position completions and progress updates
        """
        if not positions:
            yield {"type": "complete", "results": {}}
            return

        if len(positions) == 1:
            result = self.evaluate_positions_batch(positions, depth)
            position = positions[0]
            if position in result:
                yield {
                    "type": "position_complete",
                    "position": position,
                    "result": result[position],
                    "completed_count": 1
                }
            yield {"type": "progress", "completed": 1, "total": 1}
            yield {"type": "complete", "results": result}
            return

        logger.info(f"Parallel streaming evaluation of {len(positions)} positions with max {max_concurrent} concurrent requests")

        import concurrent.futures

        start_time = time.time()
        all_results = {}

        # Use ThreadPoolExecutor for concurrent HTTP requests
        with concurrent.futures.ThreadPoolExecutor(max_workers=max_concurrent) as executor:
            # Submit all positions as individual requests
            future_to_position = {
                executor.submit(self.evaluate_single_position_async, position, depth): position
                for position in positions
            }

            completed = 0
            for future in concurrent.futures.as_completed(future_to_position):
                position = future_to_position[future]
                try:
                    result = future.result()
                    if position in result:
                        position_result = result[position]
                        all_results[position] = position_result

                        # Yield individual position completion immediately
                        yield {
                            "type": "position_complete",
                            "position": position,
                            "result": position_result,
                            "completed_count": completed + 1
                        }
                    else:
                        error_result = {"error": "Position not found in response"}
                        all_results[position] = error_result

                        yield {
                            "type": "position_complete",
                            "position": position,
                            "result": error_result,
                            "completed_count": completed + 1
                        }

                except Exception as e:
                    logger.error(f"Parallel evaluation failed for {position}: {e}")
                    error_result = {"error": f"Evaluation failed: {str(e)}"}
                    all_results[position] = error_result

                    yield {
                        "type": "position_complete",
                        "position": position,
                        "result": error_result,
                        "completed_count": completed + 1
                    }

                completed += 1

                # Yield progress update for every completed evaluation
                yield {
                    "type": "progress",
                    "completed": completed,
                    "total": len(positions)
                }

                if completed % 10 == 0 or completed == len(positions):
                    logger.info(f"Parallel evaluation progress: {completed}/{len(positions)}")

        elapsed = time.time() - start_time
        success_count = len([r for r in all_results.values() if "error" not in r])

        logger.info(f"Parallel evaluation complete in {elapsed:.2f}s - {success_count}/{len(positions)} successful")
        print(f"🚀 PARALLEL: {len(positions)} positions in {elapsed:.2f}s ({elapsed/len(positions):.2f}s per position)")

        yield {"type": "complete", "results": all_results}


# Global client instance
_gcp_client = None

def get_gcp_client() -> GCPStockfishClient:
    """Get or create global GCP client instance"""
    global _gcp_client
    if _gcp_client is None:
        _gcp_client = GCPStockfishClient()
    return _gcp_client

def evaluate_positions(positions: List[str], depth: int = 20) -> Dict[str, Dict]:
    """
    Convenience function for position evaluation

    Args:
        positions: List of FEN strings
        depth: Search depth

    Returns:
        Dict mapping FEN to evaluation result
    """
    client = get_gcp_client()
    return client.evaluate_positions_chunked(positions, depth)