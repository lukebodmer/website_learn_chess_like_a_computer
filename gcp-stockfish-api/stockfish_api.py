"""
Stockfish Evaluation API for GCP Deployment

This API server provides batch position evaluation using Stockfish.
Designed to be deployed on Google Cloud Platform to handle evaluation
requests from the main Digital Ocean application.

Usage:
    POST /evaluate
    {
        "positions": [
            "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3",
            "rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq e6"
        ],
        "depth": 20
    }

    Returns:
    {
        "results": {
            "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3": {
                "evaluation": 25,
                "depth": 20,
                "time_ms": 150,
                "best": "e7e5",
                "variation": "e5 Nf3 Nc6 Bc4 Bc5",
                "nodes": 1250000,
                "knodes": 1250.0,
                "search_depth": 20,
                "search_time_ms": 145.2
            },
            // For mate positions:
            "mate_position_fen": {
                "evaluation": 9999,
                "mate": 3,
                "best": "Qh5+",
                "variation": "Qh5+ Ke8 Qe8#",
                ...
            }
        },
        "metadata": {
            "total_positions": 2,
            "successful_evaluations": 2,
            "failed_evaluations": 0,
            "total_time_seconds": 0.35,
            "average_time_per_position_ms": 175
        }
    }
"""

from flask import Flask, request, jsonify, make_response
import chess
import chess.engine
from concurrent.futures import ThreadPoolExecutor, as_completed
import logging
import time
import os
import sys
import queue
import threading
import signal
import atexit
from typing import Dict, List, Optional

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

app = Flask(__name__)

class StockfishEvaluator:
    def __init__(self, pool_size: int = None, stockfish_path: str = None):
        """
        Initialize Stockfish evaluator with persistent engine pool

        Args:
            pool_size: Number of concurrent Stockfish processes (default: based on concurrency)
            stockfish_path: Path to Stockfish binary (auto-detected if None)
        """
        # Scale pool size based on expected concurrency for Cloud Run
        if pool_size is None:
            cpu_count = os.cpu_count() or 4
            # Get Cloud Run concurrency setting (default 80)
            concurrency = int(os.environ.get('CLOUD_RUN_CONCURRENCY', '80'))
            # Get number of Gunicorn workers (default 4)
            workers = int(os.environ.get('WORKERS', '4'))

            # Size pool for expected load: target ~2 requests per engine under normal load
            # But divide by number of workers since each worker gets its own pool
            target_pool_size = max((concurrency // workers) // 2, cpu_count // workers)

            # Memory constraints: each engine uses ~100MB (64MB hash + overhead)
            # With 4Gi memory and multiple workers, limit total engines across all workers
            # 4 workers × 5 engines = 20 total engines = ~2GB, safe margin
            max_engines_per_worker = 5

            self.pool_size = min(target_pool_size, max_engines_per_worker)
            logger.info(f"Auto-sizing pool: concurrency={concurrency}, workers={workers}, cpu_count={cpu_count}, pool_size={self.pool_size}")
        else:
            self.pool_size = pool_size

        # Use a larger thread pool to handle the concurrent requests
        self.executor = ThreadPoolExecutor(max_workers=min(self.pool_size * 2, 100))

        # Auto-detect Stockfish path
        self.stockfish_path = stockfish_path or self._find_stockfish()
        if not self.stockfish_path:
            raise RuntimeError("Stockfish not found. Please install Stockfish.")

        # Initialize engine pool
        self.engine_pool = queue.Queue(maxsize=self.pool_size)
        self._shutdown_event = threading.Event()

        logger.info(f"Initialized StockfishEvaluator with {self.pool_size} engines")
        logger.info(f"Using Stockfish at: {self.stockfish_path}")

        # Initialize persistent engines
        self._initialize_engine_pool()

        # Test Stockfish availability
        self._test_stockfish()

    def _find_stockfish(self) -> Optional[str]:
        """Auto-detect Stockfish installation"""
        possible_paths = [
            "/usr/local/bin/stockfish",
            "/usr/bin/stockfish",
            "stockfish",
            "/opt/stockfish/stockfish"
        ]

        for path in possible_paths:
            try:
                with chess.engine.SimpleEngine.popen_uci(path) as engine:
                    return path
            except:
                continue
        return None

    def _initialize_engine_pool(self):
        """Initialize the persistent engine pool"""
        logger.info(f"Initializing {self.pool_size} persistent Stockfish engines...")
        for i in range(self.pool_size):
            try:
                engine = chess.engine.SimpleEngine.popen_uci(self.stockfish_path)
                # Configure engine for memory-efficient performance with smaller hash
                engine.configure({"Threads": 1})  # Single thread per engine instance
                engine.configure({"Hash": 64})    # 64MB hash table per instance (reduced for larger pool)
                self.engine_pool.put(engine)
                logger.debug(f"Initialized engine {i+1}/{self.pool_size}")
            except Exception as e:
                logger.error(f"Failed to initialize engine {i+1}: {e}")
                # Clean up any engines we already created
                self._cleanup_engines()
                raise RuntimeError(f"Failed to initialize engine pool: {e}")
        logger.info(f"Successfully initialized {self.pool_size} engines")

    def _cleanup_engines(self):
        """Clean up all engines in the pool"""
        logger.info("Cleaning up engine pool...")
        engines_closed = 0
        while not self.engine_pool.empty():
            try:
                engine = self.engine_pool.get_nowait()
                engine.quit()
                engines_closed += 1
            except queue.Empty:
                break
            except Exception as e:
                logger.error(f"Error closing engine: {e}")
        logger.info(f"Closed {engines_closed} engines")

    def shutdown(self):
        """Gracefully shutdown the evaluator and all engines"""
        logger.info("Shutting down StockfishEvaluator...")
        self._shutdown_event.set()
        self._cleanup_engines()
        self.executor.shutdown(wait=True)
        logger.info("StockfishEvaluator shutdown complete")

    def _get_engine(self, timeout=30):
        """Get an engine from the pool with timeout"""
        try:
            return self.engine_pool.get(timeout=timeout)
        except queue.Empty:
            raise RuntimeError(f"No engines available after {timeout}s timeout")

    def _return_engine(self, engine):
        """Return an engine to the pool"""
        try:
            self.engine_pool.put_nowait(engine)
        except queue.Full:
            # This shouldn't happen, but if it does, close the engine
            logger.warning("Engine pool full, closing excess engine")
            try:
                engine.quit()
            except:
                pass

    def _test_stockfish(self):
        """Test that Stockfish is working"""
        try:
            result = self.evaluate_single_position(
                "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
                depth=1
            )
            if "error" in result:
                raise RuntimeError(f"Stockfish test failed: {result['error']}")
            logger.info("Stockfish test successful")
        except Exception as e:
            raise RuntimeError(f"Stockfish test failed: {e}")

    def evaluate_single_position(self, fen: str, depth: int = 20) -> Dict:
        """
        Evaluate a single chess position using pooled engines

        Args:
            fen: FEN notation of the position
            depth: Search depth for evaluation

        Returns:
            Dict with evaluation result or error
        """
        if self._shutdown_event.is_set():
            return {"error": "Evaluator is shutting down"}

        engine = None
        try:
            start_time = time.time()

            # Get engine from pool
            engine = self._get_engine()

            board = chess.Board(fen)

            # Use time + depth limit for faster analysis
            time_limit = min(10.0, depth * 0.5)  # Max 10s, or 0.5s per depth
            analysis = engine.analyse(
                board,
                chess.engine.Limit(depth=depth, time=time_limit)
            )
            eval_time = time.time() - start_time

            # Extract evaluation score from analysis result
            # Use .white() to always get evaluation from White's perspective
            score = analysis['score'].white()
            if score.is_mate():
                # Convert mate score to large number
                mate_moves = score.mate()
                evaluation = 9999 if mate_moves > 0 else -9999
                mate_in = mate_moves
            else:
                # Handle centipawn score
                evaluation = score.score() if score.score() is not None else 0
                mate_in = None

            # Extract additional Stockfish data
            result = {
                "evaluation": evaluation,
                "depth": depth,
                "time_ms": round(eval_time * 1000, 2)
            }

            # Add mate information
            if mate_in is not None:
                result["mate"] = mate_in

            # Extract principal variation (best moves)
            if 'pv' in analysis and analysis['pv']:
                pv_moves = analysis['pv']

                # Get best move (first move in PV)
                if pv_moves:
                    result["best"] = pv_moves[0].uci()

                    # Create variation string (sequence of moves in algebraic notation)
                    variation_moves = []
                    temp_board = board.copy()

                    for move in pv_moves[:10]:  # Limit to first 10 moves
                        if move in temp_board.legal_moves:
                            # Convert to algebraic notation
                            algebraic_move = temp_board.san(move)
                            variation_moves.append(algebraic_move)
                            temp_board.push(move)
                        else:
                            break

                    if variation_moves:
                        result["variation"] = " ".join(variation_moves)

            # Extract nodes information if available
            if 'nodes' in analysis:
                result["nodes"] = analysis['nodes']
                result["knodes"] = round(analysis['nodes'] / 1000, 1)

            # Extract time information if available
            if 'time' in analysis:
                result["search_time_ms"] = round(analysis['time'] * 1000, 2)

            # Extract depth information if available
            if 'depth' in analysis:
                result["search_depth"] = analysis['depth']

            return result

        except Exception as e:
            logger.error(f"Error evaluating position {fen}: {e}")
            # If the engine failed, don't return it to pool - it might be corrupted
            if engine is not None:
                try:
                    engine.quit()
                except:
                    pass
                engine = None
                # Create a new engine to replace the failed one
                try:
                    new_engine = chess.engine.SimpleEngine.popen_uci(self.stockfish_path)
                    new_engine.configure({"Threads": 1})
                    new_engine.configure({"Hash": 64})
                    self.engine_pool.put_nowait(new_engine)
                except Exception as engine_err:
                    logger.error(f"Failed to replace corrupted engine: {engine_err}")

            return {
                "error": str(e)
            }
        finally:
            # Always return engine to pool (if we still have it)
            if engine is not None:
                self._return_engine(engine)

    def evaluate_batch(self, positions: List[str], depth: int = 20) -> Dict:
        """
        Evaluate multiple positions in parallel

        Args:
            positions: List of FEN strings to evaluate
            depth: Search depth for all evaluations

        Returns:
            Dict mapping FEN to evaluation result
        """
        if not positions:
            return {}

        logger.info(f"Starting batch evaluation of {len(positions)} positions at depth {depth}")
        start_time = time.time()

        # Submit all evaluation tasks
        future_to_fen = {
            self.executor.submit(self.evaluate_single_position, fen, depth): fen
            for fen in positions
        }

        results = {}
        completed = 0

        # Collect results as they complete
        for future in as_completed(future_to_fen):
            fen = future_to_fen[future]
            try:
                result = future.result()
                results[fen] = result
            except Exception as e:
                logger.error(f"Failed to get result for {fen}: {e}")
                results[fen] = {"error": str(e)}

            completed += 1

            # Log progress for large batches
            if completed % 50 == 0 or completed == len(positions):
                logger.info(f"Completed {completed}/{len(positions)} evaluations")

        total_time = time.time() - start_time
        logger.info(f"Batch evaluation complete in {total_time:.2f}s")

        return results

# Global evaluator instance
evaluator = None

def get_evaluator():
    """Get or create global evaluator instance"""
    global evaluator
    if evaluator is None:
        evaluator = StockfishEvaluator()
    return evaluator

def shutdown_handler(signum=None, frame=None):
    """Graceful shutdown handler"""
    global evaluator
    logger.info("Received shutdown signal, cleaning up...")
    if evaluator is not None:
        try:
            evaluator.shutdown()
        except Exception as e:
            logger.error(f"Error during evaluator cleanup: {e}")
        finally:
            evaluator = None
    sys.exit(0)

# Register cleanup handlers
signal.signal(signal.SIGTERM, shutdown_handler)
signal.signal(signal.SIGINT, shutdown_handler)
atexit.register(shutdown_handler)

@app.teardown_appcontext
def cleanup_evaluator(error):
    """Cleanup evaluator on app context teardown"""
    # Note: Don't shutdown here as it's called per request
    # The signal handlers and atexit will handle actual shutdown
    pass

@app.route('/health', methods=['GET'])
def health_check():
    """Health check endpoint"""
    try:
        eval_instance = get_evaluator()
        return jsonify({
            "status": "healthy",
            "service": "stockfish-api",
            "workers": eval_instance.pool_size,
            "stockfish_path": eval_instance.stockfish_path
        })
    except Exception as e:
        return jsonify({
            "status": "unhealthy",
            "error": str(e)
        }), 500

@app.route('/evaluate', methods=['POST'])
def evaluate_positions():
    """
    Main evaluation endpoint

    Request body:
    {
        "positions": ["fen1", "fen2", ...],
        "depth": 20  // optional, default 20
    }
    """
    try:
        # Validate request
        if not request.is_json:
            return jsonify({"error": "Content-Type must be application/json"}), 400

        data = request.get_json()
        if not data:
            return jsonify({"error": "Empty request body"}), 400

        positions = data.get('positions', [])
        # Allow environment variable to override default depth for performance tuning
        default_depth = int(os.environ.get('DEFAULT_STOCKFISH_DEPTH', '15'))
        depth = data.get('depth', default_depth)

        # Validate inputs
        if not isinstance(positions, list):
            return jsonify({"error": "positions must be a list"}), 400

        if not positions:
            return jsonify({"error": "No positions provided"}), 400

        if len(positions) > 1000:
            return jsonify({"error": "Too many positions (max 1000 per request)"}), 400

        if not isinstance(depth, int) or depth < 1 or depth > 50:
            return jsonify({"error": "depth must be an integer between 1 and 50"}), 400

        # Validate FEN strings
        invalid_fens = []
        for fen in positions:
            if not isinstance(fen, str):
                invalid_fens.append(f"Non-string FEN: {fen}")
            else:
                try:
                    chess.Board(fen)
                except:
                    invalid_fens.append(fen)

        if invalid_fens:
            return jsonify({
                "error": "Invalid FEN strings",
                "invalid_fens": invalid_fens[:10]  # Limit to first 10
            }), 400

        # Perform evaluation
        start_time = time.time()
        eval_instance = get_evaluator()
        results = eval_instance.evaluate_batch(positions, depth)
        total_time = time.time() - start_time

        # Compile metadata
        successful_evaluations = len([r for r in results.values() if "error" not in r])
        failed_evaluations = len([r for r in results.values() if "error" in r])

        response_data = {
            "results": results,
            "metadata": {
                "total_positions": len(positions),
                "successful_evaluations": successful_evaluations,
                "failed_evaluations": failed_evaluations,
                "total_time_seconds": round(total_time, 2),
                "average_time_per_position_ms": round((total_time / len(positions)) * 1000, 2) if positions else 0,
                "depth_used": depth
            }
        }

        return jsonify(response_data)

    except Exception as e:
        logger.error(f"Evaluation endpoint error: {e}")
        return jsonify({"error": str(e)}), 500

@app.route('/test', methods=['GET'])
def test_endpoint():
    """Test endpoint with a simple position"""
    test_fen = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"

    try:
        eval_instance = get_evaluator()
        result = eval_instance.evaluate_single_position(test_fen, depth=10)

        return jsonify({
            "test": "success",
            "test_position": test_fen,
            "result": result
        })

    except Exception as e:
        return jsonify({
            "test": "failed",
            "error": str(e)
        }), 500

@app.errorhandler(404)
def not_found(error):
    return jsonify({"error": "Endpoint not found"}), 404

@app.errorhandler(405)
def method_not_allowed(error):
    return jsonify({"error": "Method not allowed"}), 405

@app.errorhandler(500)
def internal_error(error):
    return jsonify({"error": "Internal server error"}), 500

if __name__ == '__main__':
    # Configuration from environment variables
    port = int(os.environ.get('PORT', 8080))
    debug = os.environ.get('DEBUG', 'false').lower() == 'true'
    host = os.environ.get('HOST', '0.0.0.0')

    logger.info(f"Starting Stockfish API server on {host}:{port}")

    try:
        # Initialize evaluator to check everything works
        get_evaluator()

        # Run Flask app
        app.run(host=host, port=port, debug=debug)

    except Exception as e:
        logger.error(f"Failed to start server: {e}")
        sys.exit(1)
