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
from .chess_analysis.principles_analyzer import ChessPrinciplesAnalyzer
from .chess_analysis.puzzle_finder import PuzzleFinder


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

            # Create enricher
            enricher = GameEnricher(games)

            # Run streaming enrichment that incrementally updates the report
            analysis_summary = self._run_enrichment_with_progress(enricher, task)

            # Mark task as completed (report was created and updated incrementally)
            with transaction.atomic():
                task.status = 'completed'
                task.completed_at = timezone.now()
                task.progress = 100
                task.save()

            # Get the report that was created incrementally
            if task.analysis_report:
                enriched_games_count = len(task.analysis_report.enriched_games) if task.analysis_report.enriched_games else 0
                print(f"✅ Task {task.id} completed successfully. Report {task.analysis_report.id} created with {enriched_games_count} enriched games")
            else:
                print(f"✅ Task {task.id} completed successfully with {analysis_summary['total_games_analyzed']} games analyzed")

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

                    # Convert to universal format with enriched opening data
                    if is_chess_com:
                        # Import the conversion function
                        from .views import convert_chess_com_to_universal_format
                        game_json = convert_chess_com_to_universal_format(raw_game_data)
                    else:
                        # Enrich Lichess data with opening FEN and moves
                        from .views import convert_lichess_to_universal_format
                        game_json = convert_lichess_to_universal_format(raw_game_data)

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
        """Run enrichment and update task progress, storing games incrementally"""
        # Get the username from the task
        username = ""
        if task.game_dataset.lichess_username:
            username = task.game_dataset.lichess_username
        elif task.game_dataset.chess_com_username:
            username = task.game_dataset.chess_com_username

        # Initialize tracking variables
        analysis_summary = {
            'total_games_analyzed': 0,
            'games_with_new_analysis': 0,
            'total_mistakes_found': 0,
            'mistake_breakdown': {'blunders': 0, 'mistakes': 0, 'inaccuracies': 0},
            'database_evaluations_used': 0,
            'stockfish_evaluations_used': 0,
            'existing_evaluations_used': 0,
        }

        # Track completed games for incremental storage
        completed_enriched_games = []
        total_expected_games = 0

        # Use the streaming enricher to get progress updates
        for update in enricher.enrich_games_with_stockfish_streaming(username):
            # Update task progress based on streaming updates
            if update.get('type') == 'init':
                # Store counts for tracking
                total_positions = update.get('total_positions', 0)
                total_expected_games = update.get('total_games', 0)

                if total_positions > 0:
                    task.current_game = f"{total_positions} positions to evaluate"
                    task.total_games = total_positions  # Repurpose for total API calls

                # Initialize empty report to store games incrementally
                from django.utils import timezone
                with transaction.atomic():
                    # Refresh task from database to get latest analysis_report_id
                    task.refresh_from_db()

                    if not task.analysis_report:
                        report = AnalysisReport.objects.create(
                            user=task.user,
                            game_dataset=task.game_dataset,
                            basic_stats={'total_games': total_expected_games, 'games_analyzed': 0},
                            terminations={},
                            openings={},
                            accuracy_analysis={},
                            stockfish_analysis=analysis_summary,
                            enriched_games=[],  # Start with empty list
                            analysis_duration=timezone.now() - task.started_at,
                            stockfish_games_analyzed=0
                        )
                        task.analysis_report = report
                        print(f"📊 Created new AnalysisReport {report.id} for task {task.id}")
                    else:
                        print(f"📊 Task {task.id} already has AnalysisReport {task.analysis_report.id}")

                task.save()

            elif update.get('type') == 'api_progress':
                # Update progress based on API call completion
                completed_calls = update.get('completed_calls', 0)
                total_calls = update.get('total_calls', 1)

                if total_calls > 0:
                    task.progress = int((completed_calls / total_calls) * 100)

                # Store exact call counts for accurate frontend progress
                task.completed_games = completed_calls
                task.total_games = total_calls

                # Update current phase description
                current_phase = update.get('current_phase', 'Processing...')
                task.current_game = current_phase
                task.save()

            elif update.get('type') == 'game_complete':
                # Individual game completed - add to our list and update report incrementally
                game_analysis = update.get('game_analysis', {})

                if game_analysis and 'game' in game_analysis:
                    game_json = game_analysis['game'].get('raw_json', {})
                    completed_enriched_games.append(game_json)

                    # Update analysis summary statistics
                    analysis_summary['total_games_analyzed'] = len(completed_enriched_games)

                    # Count mistakes from this game
                    mistakes = game_analysis.get('mistakes', [])
                    analysis_summary['total_mistakes_found'] += len(mistakes)

                    for mistake in mistakes:
                        mistake_type = mistake.get('type', '')
                        if mistake_type in analysis_summary['mistake_breakdown']:
                            analysis_summary['mistake_breakdown'][mistake_type] += 1

                    # Update report in database with new game
                    if task.analysis_report:
                        with transaction.atomic():
                            report = task.analysis_report
                            report.enriched_games = completed_enriched_games.copy()
                            report.stockfish_analysis = analysis_summary.copy()
                            report.stockfish_games_analyzed = len(completed_enriched_games)
                            report.basic_stats = {
                                'total_games': total_expected_games,
                                'games_analyzed': len(completed_enriched_games)
                            }
                            report.save()

                # Update task with game completion info
                completed_games = update.get('completed_games', len(completed_enriched_games))
                total_games = update.get('total_games', total_expected_games)
                task.current_game = f"Completed {completed_games}/{total_games} games"
                task.save()

            elif update.get('type') == 'error':
                print(f"Enrichment error in task {task.id}: {update.get('error')}")
                break

            elif update.get('type') == 'complete':
                # Final completion
                task.progress = 95  # Leave 5% for principles analysis
                task.current_game = f"Analysis complete - {len(completed_enriched_games)} games processed. Running principles analysis..."

                # Final update to analysis summary
                analysis_summary['total_games_analyzed'] = len(completed_enriched_games)

                # Run principles analysis on enriched games
                print(f"📊 Running principles analysis on {len(completed_enriched_games)} enriched games")
                task.current_game = "Analyzing chess principles..."
                task.save()

                try:
                    # Create principles analyzer
                    principles_analyzer = ChessPrinciplesAnalyzer(
                        enriched_games=completed_enriched_games,
                        username=username
                    )

                    # Run all principles analysis
                    principles_results = principles_analyzer.analyze_all_principles()

                    # Add principles results to analysis summary
                    analysis_summary['principles'] = principles_results

                    print(f"✅ Principles analysis complete. ELO range: {principles_results.get('elo_range')}, Games: {principles_results.get('total_games_analyzed')}")

                    # Generate custom puzzles based on principles analysis
                    task.progress = 97
                    task.current_game = "Generating custom puzzle recommendations..."
                    task.save()

                    try:
                        # Determine user rating from enriched games
                        user_rating = self._get_user_average_rating(completed_enriched_games, username)

                        if user_rating and user_rating > 0:
                            print(f"📊 Generating puzzles for user rating: {user_rating}")

                            # Create puzzle finder with principles analysis
                            puzzle_finder = PuzzleFinder(principles_results, target_puzzle_count=1000)

                            # Get puzzle recommendations
                            puzzle_recommendations = puzzle_finder.get_puzzle_recommendations(user_rating)

                            # Store puzzle data separately (not in analysis_summary)
                            task.puzzle_data = puzzle_recommendations

                            puzzles_found = puzzle_recommendations.get('total_puzzles_found', 0)
                            print(f"✅ Generated {puzzles_found} custom puzzles for training")
                        else:
                            print(f"⚠️ Could not determine user rating, skipping puzzle generation")
                            task.puzzle_data = None

                    except Exception as e:
                        print(f"❌ Puzzle generation failed: {e}")
                        # Continue even if puzzle generation fails
                        task.puzzle_data = {
                            'error': str(e),
                            'puzzles': [],
                            'total_puzzles_found': 0
                        }

                except Exception as e:
                    print(f"❌ Principles analysis failed: {e}")
                    # Continue even if principles analysis fails
                    analysis_summary['principles'] = {
                        'error': str(e),
                        'elo_range': 'unknown',
                        'total_games_analyzed': 0,
                        'principles': {}
                    }
                    analysis_summary['puzzle_recommendations'] = None

                # Update final progress
                task.progress = 100
                task.current_game = f"Complete - {len(completed_enriched_games)} games analyzed with principles"

                # Update report with final stats including principles and puzzles
                if task.analysis_report:
                    with transaction.atomic():
                        report = task.analysis_report
                        report.enriched_games = completed_enriched_games.copy()
                        report.stockfish_analysis = analysis_summary.copy()
                        report.stockfish_games_analyzed = len(completed_enriched_games)

                        # Store puzzle data in dedicated field
                        if hasattr(task, 'puzzle_data') and task.puzzle_data:
                            report.custom_puzzles = task.puzzle_data.get('puzzles', [])

                        from django.utils import timezone
                        report.analysis_duration = timezone.now() - task.started_at
                        report.save()

                task.save()
                break

        return analysis_summary

    def _get_user_average_rating(self, enriched_games, username):
        """
        Calculate user's average rating from enriched games.

        Args:
            enriched_games: List of enriched game dictionaries
            username: Username to find rating for

        Returns:
            Average rating as integer, or None if not found
        """
        ratings = []
        username_lower = username.lower()

        for game in enriched_games:
            players = game.get("players", {})

            # Check white player
            white_user = players.get("white", {}).get("user", {}).get("name", "").lower()
            if white_user == username_lower:
                rating = players.get("white", {}).get("rating")
                if rating:
                    ratings.append(rating)
                continue

            # Check black player
            black_user = players.get("black", {}).get("user", {}).get("name", "").lower()
            if black_user == username_lower:
                rating = players.get("black", {}).get("rating")
                if rating:
                    ratings.append(rating)

        if not ratings:
            return None

        # Return average rating
        return int(sum(ratings) / len(ratings))

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
