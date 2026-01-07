"""
Background task processor for generating analysis reports
"""
import json
import threading
import time
from django.utils import timezone
from django.db import transaction
from .models import ReportGenerationTask, AnalysisReport
from .chess_analysis.game_enricher import GameEnricher


class ReportTaskProcessor:
    """Process analysis report generation tasks in the background"""

    def __init__(self):
        self._running = False
        self._thread = None

    def start(self):
        """Start the background processor thread"""
        if self._running:
            return

        self._running = True
        self._thread = threading.Thread(target=self._process_loop, daemon=True)
        self._thread.start()
        print("📊 Report task processor started")

    def stop(self):
        """Stop the background processor"""
        self._running = False
        if self._thread and self._thread.is_alive():
            self._thread.join()
        print("📊 Report task processor stopped")

    def _process_loop(self):
        """Main processing loop"""
        while self._running:
            try:
                # Look for pending tasks
                task = ReportGenerationTask.objects.filter(status='pending').first()

                if task:
                    print(f"📊 Processing task {task.id} for user {task.user.username}")
                    self._process_task(task)
                else:
                    # No tasks, sleep briefly
                    time.sleep(2)

            except Exception as e:
                print(f"❌ Error in task processor loop: {e}")
                time.sleep(5)  # Wait longer on error

    def _process_task(self, task):
        """Process a single report generation task"""
        try:
            # Mark as running
            with transaction.atomic():
                task.status = 'running'
                task.started_at = timezone.now()
                task.save()

            # Parse games from dataset
            games = self._parse_games_from_dataset(task.game_dataset)

            if not games:
                self._fail_task(task, "No games found in dataset")
                return

            # Initialize - total_games will be set to total_positions during init
            task.total_games = 0
            task.save()

            # Create enricher with progress callback
            enricher = GameEnricher(games)

            # Create a custom streaming enricher that updates the task
            analysis_summary = self._run_enrichment_with_progress(enricher, task)

            # Extract enriched games data
            enriched_games_data = []
            for game in games:
                enriched_games_data.append(game.get('raw_json', {}))

            # Calculate basic stats
            basic_stats = {
                'total_games': len(enriched_games_data),
                'games_analyzed': analysis_summary['total_games_analyzed']
            }

            # Create AnalysisReport with enriched data
            with transaction.atomic():
                report = AnalysisReport.objects.create(
                    user=task.user,
                    game_dataset=task.game_dataset,
                    basic_stats=basic_stats,
                    terminations={},  # Could be calculated from enriched data
                    openings={},      # Could be calculated from enriched data
                    accuracy_analysis={},  # Could be calculated from enriched data
                    stockfish_analysis=analysis_summary,
                    enriched_games=enriched_games_data,
                    analysis_duration=timezone.now() - task.started_at,
                    stockfish_games_analyzed=analysis_summary['total_games_analyzed']
                )

                # Mark task as completed
                task.status = 'completed'
                task.completed_at = timezone.now()
                task.progress = 100
                task.analysis_report = report
                task.save()

            print(f"✅ Task {task.id} completed successfully. Report {report.id} created with {len(enriched_games_data)} enriched games")

        except Exception as e:
            print(f"❌ Task {task.id} failed: {e}")
            self._fail_task(task, str(e))

    def _parse_games_from_dataset(self, game_dataset):
        """Parse games from GameDataSet raw_data"""
        games = []
        is_chess_com = bool(game_dataset.chess_com_username)


        for line in game_dataset.raw_data.strip().split('\n'):
            if line.strip():
                try:
                    raw_game_data = json.loads(line)

                    # Convert Chess.com data to Lichess format if needed
                    if is_chess_com:
                        # Import the conversion function
                        from .views import convert_chess_com_to_lichess_format
                        game_json = convert_chess_com_to_lichess_format(raw_game_data)
                    else:
                        game_json = raw_game_data

                    # Parse into our game format
                    players = game_json.get("players", {})
                    game_data = {
                        "white_player": players.get("white", {}).get("user", {}).get("name", "Unknown"),
                        "black_player": players.get("black", {}).get("user", {}).get("name", "Unknown"),
                        "opening": game_json.get("opening", {}).get("name", "Unknown"),
                        "raw_json": game_json,
                    }
                    games.append(game_data)
                except json.JSONDecodeError as e:
                    print(f"Error parsing game data: {e}")
                    continue
                except Exception as e:
                    print(f"Error converting Chess.com game: {e}")
                    continue


        return games

    def _run_enrichment_with_progress(self, enricher, task):
        """Run enrichment and update task progress based on API calls"""
        # Get the username from the task
        username = ""
        if task.game_dataset.lichess_username:
            username = task.game_dataset.lichess_username
        elif task.game_dataset.chess_com_username:
            username = task.game_dataset.chess_com_username

        analysis_summary = {
            'total_games_analyzed': 0,
            'games_with_new_analysis': 0,
            'total_mistakes_found': 0,
            'mistake_breakdown': {'blunders': 0, 'mistakes': 0, 'inaccuracies': 0},
            'database_evaluations_used': 0,
            'stockfish_evaluations_used': 0,
            'existing_evaluations_used': 0,
        }

        # Use the streaming enricher to get progress updates
        for update in enricher.enrich_games_with_stockfish_streaming(username):
            # Update task progress based on streaming updates
            if update.get('type') == 'init':
                # Store position count for tracking
                total_positions = update.get('total_positions', 0)
                if total_positions > 0:
                    task.current_game = f"{total_positions} positions to evaluate"
                    task.total_games = total_positions  # Repurpose for total API calls
                task.save()

            elif update.get('type') == 'api_progress':
                # Update progress based on API call completion
                completed_calls = update.get('completed_calls', 0)
                total_calls = update.get('total_calls', 1)

                if total_calls > 0:
                    task.progress = int((completed_calls / total_calls) * 100)

                # Store exact call counts for accurate frontend progress
                # Using existing fields: completed_games for completed_calls, total_games for total_calls
                task.completed_games = completed_calls
                task.total_games = total_calls

                # Update current phase description
                current_phase = update.get('current_phase', 'Processing...')
                task.current_game = current_phase
                task.save()


            elif update.get('type') == 'error':
                print(f"Enrichment error in task {task.id}: {update.get('error')}")
                break

            elif update.get('type') == 'complete':
                task.progress = 100
                task.current_game = "Analysis complete"
                task.save()
                break

        return analysis_summary

    def _fail_task(self, task, error_message):
        """Mark task as failed"""
        try:
            with transaction.atomic():
                task.status = 'failed'
                task.completed_at = timezone.now()
                task.error_message = error_message
                task.save()
        except Exception as e:
            print(f"❌ Error updating failed task: {e}")


# Global processor instance
_processor = None

def start_task_processor():
    """Start the global task processor"""
    global _processor
    if _processor is None:
        _processor = ReportTaskProcessor()
        _processor.start()

def stop_task_processor():
    """Stop the global task processor"""
    global _processor
    if _processor:
        _processor.stop()
        _processor = None

def get_task_processor():
    """Get the global task processor instance"""
    global _processor
    return _processor