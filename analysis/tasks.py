"""
Celery tasks for async processing of Chess.com and Lichess API requests
"""
from celery import shared_task
from django.core.cache import cache
from django.utils import timezone
from datetime import datetime
import json
import time
import requests
from chessdotcom import get_player_game_archives, get_player_games_by_month, Client
from .models import GameDataSet, UserProfile
from .views import (
    convert_chess_com_game_to_dict,
    create_game_dataset,
    get_latest_elo_by_time_control,
    format_date_range_for_display,
    track_game_dates,
    find_unanalyzed_dataset,
    update_game_dataset,
    ANALYSIS_GAME_COUNT
)

# Configure Chess.com client User-Agent for tasks
Client.request_config["headers"]["User-Agent"] = (
    "Learn Chess Like a Computer - Chess Analysis Tool. "
    "Contact: learnchesslikeacomputer@gmail.com"
)


# Global rate limiting using Redis cache
# Chess.com's actual rate limit policy (from official docs):
# - Serial access is UNLIMITED
# - Parallel requests trigger 429
# - If 429 received, wait 60 seconds
#
# Strategy: Use Redis lock to ensure only ONE Chess.com API request
# is active at a time across ALL workers (serial access only)

RATE_LIMIT_LOCK_KEY = 'chess_com_api_lock'
RATE_LIMIT_429_KEY = 'chess_com_api_429_received'
LOCK_TIMEOUT = 10  # Lock expires after 10 seconds (safety measure)
RATE_LIMIT_WAIT = 60  # Wait 60 seconds if 429 received


def acquire_chess_com_api_lock():
    """
    Acquire exclusive lock for Chess.com API access (serial access only).
    Returns True if lock acquired, False otherwise.
    Uses Redis SET NX (set if not exists) for atomic lock acquisition.
    """
    # Check if we received a 429 recently and need to wait
    if cache.get(RATE_LIMIT_429_KEY):
        print(f"⚠️  429 rate limit active. Waiting...")
        return False

    # Try to acquire lock atomically
    # SET NX with timeout ensures only one worker can hold the lock
    try:
        acquired = cache.add(RATE_LIMIT_LOCK_KEY, '1', LOCK_TIMEOUT)
        if acquired:
            print(f"✓ Lock acquired: {RATE_LIMIT_LOCK_KEY}")
        return acquired
    except Exception as e:
        print(f"❌ Error acquiring lock: {e}")
        return False


def release_chess_com_api_lock():
    """
    Release the Chess.com API lock
    """
    cache.delete(RATE_LIMIT_LOCK_KEY)


def mark_429_received():
    """
    Mark that we received a 429 response and need to wait 60 seconds
    """
    print(f"⚠️  429 Too Many Requests received! Waiting {RATE_LIMIT_WAIT} seconds...")
    cache.set(RATE_LIMIT_429_KEY, '1', RATE_LIMIT_WAIT)


def wait_for_api_access():
    """
    Wait until we can make a Chess.com API call (acquire lock).
    Ensures serial access across all workers.
    """
    attempts = 0
    max_attempts = 600  # 60 seconds max wait (600 * 0.1s)

    while not acquire_chess_com_api_lock():
        attempts += 1
        if attempts >= max_attempts:
            raise Exception("Timeout waiting for Chess.com API lock after 60 seconds")
        if attempts % 10 == 0:  # Log every second
            print(f"Waiting for Chess.com API lock... ({attempts/10}s)")
        time.sleep(0.1)  # Check every 100ms

    print("✓ Chess.com API lock acquired")


@shared_task(bind=True, max_retries=3)
def fetch_chess_com_games_task(self, user_id, username, max_games=ANALYSIS_GAME_COUNT, since_timestamp=None):
    """
    Background task to fetch Chess.com games with serial access rate limiting

    Chess.com Rate Limit Policy:
    - Serial access (one request at a time) is UNLIMITED
    - Parallel requests trigger 429
    - If 429 received, wait 60 seconds

    This task ensures serial access using Redis locks.

    Args:
        user_id: Django user ID
        username: Chess.com username
        max_games: Maximum number of games to fetch
        since_timestamp: Optional timestamp (seconds) to fetch games since

    Returns:
        Dictionary with game data or error information
    """
    try:
        # Get user object
        from django.contrib.auth.models import User
        user = User.objects.get(id=user_id)

        # Update task state to show progress
        self.update_state(
            state='PROGRESS',
            meta={'current': 0, 'total': 100, 'status': 'Starting fetch...'}
        )

        # Validate max_games to prevent abuse
        if max_games < 1 or max_games > 1000:
            max_games = ANALYSIS_GAME_COUNT

        # Check for unanalyzed dataset that can be reused/updated
        existing_dataset, should_update = find_unanalyzed_dataset(user, username, platform='chess.com')

        # If since_timestamp is provided, check if we're looking for games after the last analyzed dataset
        # If so, we can skip API calls entirely by comparing timestamps
        if since_timestamp and not existing_dataset:
            # Find the most recent analyzed dataset
            last_analyzed = GameDataSet.objects.filter(
                user=user,
                chess_com_username=username,
                analysis_generated=True
            ).order_by('-created_at').first()

            if last_analyzed and last_analyzed.newest_game_date:
                # Convert newest_game_date to timestamp (seconds) for comparison
                last_game_timestamp = int(last_analyzed.newest_game_date.timestamp())

                # If the since_timestamp is very close to the last game (within 10 seconds),
                # it means we're checking right after generating a report and likely have no new games
                # Skip the API calls and return early
                time_diff = abs(since_timestamp - last_game_timestamp)
                if time_diff < 10:  # Within 10 seconds
                    print(f"since_timestamp ({since_timestamp}) is very close to last analyzed game ({last_game_timestamp}). Skipping API calls.")
                    return {
                        'success': False,
                        'error': 'No new games found since your last analyzed dataset. Play some more games and try again!'
                    }

        if existing_dataset and not should_update:
            # Dataset is less than 5 minutes old - return it as-is without fetching
            print(f"Reusing Chess.com dataset {existing_dataset.id} (created {existing_dataset.created_at}) with {existing_dataset.total_games} games")

            # Get latest ELO ratings
            elo_by_time_control = get_latest_elo_by_time_control(
                existing_dataset.raw_data,
                username,
                'chess.com'
            )

            date_range_str = format_date_range_for_display(
                existing_dataset.oldest_game_date,
                existing_dataset.newest_game_date
            )

            return {
                'success': True,
                'games_count': existing_dataset.total_games,
                'game_dataset_id': existing_dataset.id,
                'date_range': date_range_str or "Date range unavailable",
                'created_at': existing_dataset.created_at.strftime("%B %d, %Y at %I:%M %p"),
                'data_size': len(existing_dataset.raw_data),
                'elo_ratings': elo_by_time_control,
                'ndjson_data': existing_dataset.raw_data
            }

        if existing_dataset and should_update:
            # Dataset is 5min-24hr old with < 100 games - fetch new games and update it
            print(f"Found unanalyzed Chess.com dataset {existing_dataset.id} with {existing_dataset.total_games} games")
            # Adjust max_games to only fetch what we need to reach 100
            games_to_fetch = max_games - existing_dataset.total_games

            # Update max_games for incremental fetch
            max_games = games_to_fetch
            print(f"Fetching {max_games} additional games for Chess.com dataset")

        # Acquire lock for Chess.com API (ensures serial access)
        wait_for_api_access()

        try:
            # Get player's game archives to find most recent games
            self.update_state(
                state='PROGRESS',
                meta={'current': 10, 'total': 100, 'status': 'Fetching game archives...'}
            )

            archives_response = get_player_game_archives(username)
        except Exception as e:
            # Check if it's a 429 error
            if '429' in str(e):
                mark_429_received()
                release_chess_com_api_lock()
                raise self.retry(exc=e, countdown=RATE_LIMIT_WAIT)
            raise
        finally:
            release_chess_com_api_lock()

        if not archives_response.archives:
            return {
                'success': False,
                'error': 'No game archives found for this Chess.com account.'
            }

        # Filter criteria
        allowed_time_classes = {'bullet', 'blitz', 'rapid'}

        # Smart fetching strategy: filter as we go and keep fetching until we have enough qualified games
        qualified_games = []
        total_games_checked = 0
        api_calls_made = 0
        max_api_calls = 50  # Safety limit to avoid excessive API calls

        # Start from most recent and work backwards
        archives_to_check = list(reversed(archives_response.archives))

        for i, archive_url in enumerate(archives_to_check):
            # Stop if we have enough qualified games
            if len(qualified_games) >= max_games:
                break

            # Safety limit on API calls
            if api_calls_made >= max_api_calls:
                print(f"Reached API call limit ({max_api_calls}). Collected {len(qualified_games)} qualified games.")
                break

            # Update progress
            progress = 10 + int((i / min(len(archives_to_check), 10)) * 80)
            self.update_state(
                state='PROGRESS',
                meta={
                    'current': progress,
                    'total': 100,
                    'status': f'Fetching games... {len(qualified_games)}/{max_games} found',
                    'games_found': len(qualified_games)
                }
            )

            # Extract year and month from URL
            url_parts = archive_url.split('/')
            year = url_parts[-2]
            month = url_parts[-1]

            try:
                # Acquire lock for serial access to Chess.com API
                wait_for_api_access()

                try:
                    # No need for progressive delay since serial access is unlimited
                    games_response = get_player_games_by_month(username, year, month)
                    api_calls_made += 1
                except Exception as e:
                    # Check if it's a 429 error
                    if '429' in str(e):
                        mark_429_received()
                        release_chess_com_api_lock()
                        # Wait and retry
                        time.sleep(RATE_LIMIT_WAIT)
                        continue
                    raise
                finally:
                    release_chess_com_api_lock()

                if games_response.games:
                    # Process each game in the month
                    for game in games_response.games:
                        total_games_checked += 1

                        try:
                            game_data = convert_chess_com_game_to_dict(game)

                            # Check if game meets our criteria
                            time_class = game_data.get('time_class', '').lower()
                            is_rated = game_data.get('rated', True)
                            end_time = game_data.get('end_time', 0)

                            # If since_timestamp is provided, filter out games that ended before it
                            if since_timestamp and end_time <= since_timestamp:
                                continue

                            if time_class in allowed_time_classes and is_rated:
                                qualified_games.append(game_data)
                                print(f"Added qualified game ({len(qualified_games)}/{max_games}): {time_class} from {year}/{month}")

                                # Stop processing this month if we have enough
                                if len(qualified_games) >= max_games:
                                    break

                        except Exception as e:
                            print(f"Error processing game: {e}")
                            continue

                    print(f"Checked {year}/{month}: {len(qualified_games)} qualified games collected so far (API calls: {api_calls_made})")

            except Exception as e:
                print(f"Error fetching games for {year}/{month}: {e}")
                api_calls_made += 1  # Count failed requests too
                continue

        print(f"Final result: {len(qualified_games)} qualified games collected from {total_games_checked} total games using {api_calls_made} API calls")

        # Check if we have any qualified games
        if not qualified_games:
            # If since_timestamp was provided, this means user is checking for new games after generating a report
            if since_timestamp:
                # Check if we have an existing unanalyzed dataset to update
                if existing_dataset:
                    print(f"No new games found for Chess.com since {since_timestamp}, returning existing dataset")

                    # Get latest ELO ratings from existing dataset
                    elo_by_time_control = get_latest_elo_by_time_control(
                        existing_dataset.raw_data,
                        username,
                        'chess.com'
                    )

                    date_range_str = format_date_range_for_display(
                        existing_dataset.oldest_game_date,
                        existing_dataset.newest_game_date
                    )

                    return {
                        'success': True,
                        'games_count': existing_dataset.total_games,
                        'game_dataset_id': existing_dataset.id,
                        'date_range': date_range_str or "Date range unavailable",
                        'created_at': existing_dataset.created_at.strftime("%B %d, %Y at %I:%M %p"),
                        'data_size': len(existing_dataset.raw_data),
                        'elo_ratings': elo_by_time_control,
                        'ndjson_data': existing_dataset.raw_data
                    }
                else:
                    # No existing unanalyzed dataset, but since_timestamp was provided
                    # This means user is checking for new games after generating a report
                    # Return success with 0 games found
                    print(f"No new games found for Chess.com since {since_timestamp}, and all datasets are analyzed")
                    return {
                        'success': False,
                        'error': 'No new games found since your last analyzed dataset. Play some more games and try again!'
                    }
            else:
                # Initial fetch with no games - this is an error
                return {
                    'success': False,
                    'error': f'No rated bullet, blitz, or rapid games found after checking {total_games_checked} games. Only these time controls are supported.'
                }

        # Update progress
        self.update_state(
            state='PROGRESS',
            meta={'current': 90, 'total': 100, 'status': 'Saving game data...'}
        )

        # Track newest game timestamp for duplicate detection
        newest_game_timestamp = max(game.get('end_time', 0) for game in qualified_games) if qualified_games else 0

        # If since_timestamp was provided but no existing_dataset exists,
        # check if the fetched games are duplicates of already-analyzed games
        if since_timestamp and not existing_dataset and newest_game_timestamp:
            # Find the last analyzed dataset for this user
            last_analyzed_dataset = GameDataSet.objects.filter(
                user=user,
                chess_com_username=username,
                analysis_generated=True
            ).order_by('-created_at').first()

            if last_analyzed_dataset and last_analyzed_dataset.newest_game_date:
                # Convert newest_game_date to timestamp (seconds)
                last_analyzed_timestamp = int(last_analyzed_dataset.newest_game_date.timestamp())

                # Check if the newest fetched game is older than or equal to the last analyzed game
                if newest_game_timestamp <= last_analyzed_timestamp:
                    print(f"Fetched Chess.com games are duplicates (newest: {newest_game_timestamp} <= last analyzed: {last_analyzed_timestamp})")
                    return {
                        'success': False,
                        'error': 'No new games found since your last analyzed dataset. Play some more games and try again!'
                    }

        # Convert qualified games to NDJSON format
        ndjson_lines = []
        for game_data in qualified_games:
            ndjson_lines.append(json.dumps(game_data))

        ndjson_data = '\n'.join(ndjson_lines)

        # Update existing dataset or create new one
        if existing_dataset:
            print(f"Updating existing Chess.com dataset {existing_dataset.id} with {len(qualified_games)} new games")
            game_dataset = update_game_dataset(
                existing_dataset,
                qualified_games,
                ndjson_data,
                platform='chess.com'
            )
        else:
            # Create new GameDataSet
            game_dataset = create_game_dataset(
                user=user,
                username=username,
                games_data=qualified_games,
                ndjson_data=ndjson_data,
                platform='chess.com'
            )

        # Format date range using shared utility
        date_range_str = format_date_range_for_display(
            game_dataset.oldest_game_date,
            game_dataset.newest_game_date
        )

        # Get latest ELO ratings by time control (use updated dataset's data)
        elo_by_time_control = get_latest_elo_by_time_control(
            game_dataset.raw_data,
            username,
            'chess.com'
        )

        # Final update
        self.update_state(
            state='PROGRESS',
            meta={'current': 100, 'total': 100, 'status': 'Complete!'}
        )

        return {
            'success': True,
            'games_count': game_dataset.total_games,
            'game_dataset_id': game_dataset.id,
            'date_range': date_range_str or "Date range unavailable",
            'created_at': game_dataset.created_at.strftime("%B %d, %Y at %I:%M %p"),
            'data_size': len(game_dataset.raw_data),
            'elo_ratings': elo_by_time_control,
            'ndjson_data': game_dataset.raw_data
        }

    except Exception as e:
        print(f"Error in fetch_chess_com_games_task: {e}")
        # Retry the task if it fails
        raise self.retry(exc=e, countdown=60)  # Retry after 1 minute


# ============================================================================
# Lichess API Rate Limiting (same policy as Chess.com)
# ============================================================================

# Lichess's Official Rate Limit Policy:
# "All requests are rate limited using various strategies, to ensure the API
# remains responsive for everyone. Only make one request at a time. If you
# receive an HTTP response with a 429 status, please wait a full minute
# before resuming API usage."
#
# Strategy: Use Redis lock to ensure only ONE Lichess API request
# is active at a time across ALL workers (serial access only)

LICHESS_RATE_LIMIT_LOCK_KEY = 'lichess_api_lock'
LICHESS_RATE_LIMIT_429_KEY = 'lichess_api_429_received'
LICHESS_LOCK_TIMEOUT = 30  # Lock expires after 30 seconds (Lichess streaming can be slow)
LICHESS_RATE_LIMIT_WAIT = 60  # Wait 60 seconds if 429 received


def acquire_lichess_api_lock():
    """
    Acquire exclusive lock for Lichess API access (serial access only).
    Returns True if lock acquired, False otherwise.
    """
    # Check if we received a 429 recently and need to wait
    if cache.get(LICHESS_RATE_LIMIT_429_KEY):
        print(f"Lichess 429 rate limit active. Waiting...")
        return False

    # Try to acquire lock atomically
    acquired = cache.add(LICHESS_RATE_LIMIT_LOCK_KEY, '1', LICHESS_LOCK_TIMEOUT)
    return acquired


def release_lichess_api_lock():
    """
    Release the Lichess API lock
    """
    cache.delete(LICHESS_RATE_LIMIT_LOCK_KEY)


def mark_lichess_429_received():
    """
    Mark that we received a 429 response and need to wait 60 seconds
    """
    print(f"⚠️  Lichess 429 Too Many Requests received! Waiting {LICHESS_RATE_LIMIT_WAIT} seconds...")
    cache.set(LICHESS_RATE_LIMIT_429_KEY, '1', LICHESS_RATE_LIMIT_WAIT)


def wait_for_lichess_api_access():
    """
    Wait until we can make a Lichess API call (acquire lock).
    Ensures serial access across all workers.
    """
    while not acquire_lichess_api_lock():
        time.sleep(0.1)  # Check every 100ms


@shared_task(bind=True, max_retries=3)
def fetch_lichess_games_task(self, user_id, username, access_token, max_games=ANALYSIS_GAME_COUNT, since_timestamp=None):
    """
    Background task to fetch Lichess games with serial access rate limiting

    Lichess Rate Limit Policy:
    - Serial access (one request at a time) is required
    - Parallel requests trigger 429
    - If 429 received, wait 60 seconds

    This task ensures serial access using Redis locks.

    Args:
        user_id: Django user ID
        username: Lichess username
        access_token: Lichess OAuth access token
        max_games: Maximum number of games to fetch
        since_timestamp: Optional timestamp (milliseconds) to fetch games since

    Returns:
        Dictionary with game data or error information
    """
    try:
        # Get user object
        from django.contrib.auth.models import User
        user = User.objects.get(id=user_id)

        # Update task state to show progress
        self.update_state(
            state='PROGRESS',
            meta={'current': 0, 'total': 100, 'status': 'Starting fetch...'}
        )

        # Validate max_games to prevent abuse
        if max_games < 1 or max_games > 1000:
            max_games = ANALYSIS_GAME_COUNT

        # Check for unanalyzed dataset that can be reused/updated
        existing_dataset, should_update = find_unanalyzed_dataset(user, username, platform='lichess')

        # If since_timestamp is provided, check if we're looking for games after the last analyzed dataset
        # If so, we can skip API calls entirely by comparing timestamps
        if since_timestamp and not existing_dataset:
            # Find the most recent analyzed dataset
            last_analyzed = GameDataSet.objects.filter(
                user=user,
                lichess_username=username,
                analysis_generated=True
            ).order_by('-created_at').first()

            if last_analyzed and last_analyzed.newest_game_date:
                # Convert newest_game_date to timestamp (milliseconds) for comparison
                last_game_timestamp = int(last_analyzed.newest_game_date.timestamp() * 1000)

                # If the since_timestamp is very close to the last game (within 10 seconds),
                # it means we're checking right after generating a report and likely have no new games
                # Skip the API calls and return early
                time_diff_ms = abs(since_timestamp - last_game_timestamp)
                if time_diff_ms < 10000:  # Within 10 seconds (10000 ms)
                    print(f"since_timestamp ({since_timestamp}) is very close to last analyzed game ({last_game_timestamp}). Skipping API calls.")
                    return {
                        'success': False,
                        'error': 'No new games found since your last analyzed dataset. Play some more games and try again!'
                    }

        if existing_dataset and not should_update:
            # Dataset is less than 5 minutes old - return it as-is without fetching
            print(f"Reusing dataset {existing_dataset.id} (created {existing_dataset.created_at}) with {existing_dataset.total_games} games")

            # Get latest ELO ratings
            elo_by_time_control = get_latest_elo_by_time_control(
                existing_dataset.raw_data,
                username,
                'lichess'
            )

            return {
                'success': True,
                'games_count': existing_dataset.total_games,
                'game_dataset_id': existing_dataset.id,
                'created_at': existing_dataset.created_at.strftime("%B %d, %Y %I:%M %p"),
                'data_size': len(existing_dataset.raw_data),
                'date_range': existing_dataset.date_range_display,
                'oldest_game_date': existing_dataset.oldest_game_date.strftime("%B %d, %Y") if existing_dataset.oldest_game_date else None,
                'newest_game_date': existing_dataset.newest_game_date.strftime("%B %d, %Y") if existing_dataset.newest_game_date else None,
                'elo_ratings': elo_by_time_control,
                'ndjson_data': existing_dataset.raw_data
            }

        if existing_dataset and should_update:
            # Dataset is 5min-24hr old with < 100 games - fetch new games and update it
            print(f"Found unanalyzed dataset {existing_dataset.id} with {existing_dataset.total_games} games")
            # Adjust max_games to only fetch what we need to reach 100
            games_to_fetch = max_games - existing_dataset.total_games

            # Update max_games and since_timestamp for incremental fetch
            max_games = games_to_fetch
            if existing_dataset.newest_game_date:
                # Fetch games newer than the newest game in the dataset
                since_timestamp = int(existing_dataset.newest_game_date.timestamp() * 1000) + 1
                print(f"Fetching {max_games} new games since {existing_dataset.newest_game_date}")

        # Acquire lock for Lichess API (ensures serial access)
        wait_for_lichess_api_access()

        try:
            # Fetch games from Lichess
            self.update_state(
                state='PROGRESS',
                meta={'current': 30, 'total': 100, 'status': 'Fetching games from Lichess...'}
            )

            api_params = {
                "max": max_games,
                "moves": "true",
                "tags": "true",
                "clocks": "true",
                "evals": "true",
                "accuracy": "true",
                "opening": "true",
                "division": "true",
                "finished": "true",
                "rated": "true",
                "perfType": "bullet,blitz,rapid",  # Filter at API level instead of in Python
                "sort": "dateDesc",
            }

            # Add 'since' parameter if provided (fetch games newer than this timestamp)
            if since_timestamp:
                api_params["since"] = since_timestamp

            response = requests.get(
                f"https://lichess.org/api/games/user/{username}",
                headers={
                    "Authorization": f"Bearer {access_token}",
                    "Accept": "application/x-ndjson",
                },
                params=api_params,
            )

            # Check for 429 rate limit
            if response.status_code == 429:
                mark_lichess_429_received()
                release_lichess_api_lock()
                raise self.retry(exc=Exception("429 rate limit"), countdown=LICHESS_RATE_LIMIT_WAIT)

            if response.status_code != 200:
                release_lichess_api_lock()
                return {
                    'success': False,
                    'error': f'Lichess API returned status {response.status_code}'
                }

        except Exception as e:
            # Check if it's a 429 error
            if '429' in str(e):
                mark_lichess_429_received()
                release_lichess_api_lock()
                raise self.retry(exc=e, countdown=LICHESS_RATE_LIMIT_WAIT)
            raise
        finally:
            release_lichess_api_lock()

        # Process response
        self.update_state(
            state='PROGRESS',
            meta={'current': 60, 'total': 100, 'status': 'Processing games...'}
        )

        ndjson_data = response.text
        lines = [line for line in ndjson_data.strip().split('\n') if line.strip()]
        games = []
        filtered_ndjson_lines = []
        allowed_speeds = {'bullet', 'blitz', 'rapid'}

        # Parse games and filter for rated games with allowed speeds only
        for line in lines:
            try:
                game = json.loads(line)
                speed = game.get('speed', '').lower()
                if game.get('rated', False) and speed in allowed_speeds:
                    # Limit to max_games (Lichess API sometimes returns more than requested)
                    if len(games) < max_games:
                        games.append(game)
                        filtered_ndjson_lines.append(line)
            except json.JSONDecodeError:
                continue

        # Rebuild ndjson_data with only rated bullet/blitz/rapid games
        filtered_ndjson_data = '\n'.join(filtered_ndjson_lines)

        # Handle case where no new games were found
        if len(games) == 0:
            # If we're doing an incremental fetch (since_timestamp is set), this is SUCCESS
            # It means no new games since last time
            if since_timestamp:
                # Check if we have an existing unanalyzed dataset to update
                if existing_dataset:
                    print(f"No new games found since {since_timestamp}, returning existing dataset")

                    # Get latest ELO ratings from existing dataset
                    elo_by_time_control = get_latest_elo_by_time_control(
                        existing_dataset.raw_data,
                        username,
                        'lichess'
                    )

                    date_range_str = format_date_range_for_display(
                        existing_dataset.oldest_game_date,
                        existing_dataset.newest_game_date
                    )

                    return {
                        'success': True,
                        'games_count': existing_dataset.total_games,
                        'game_dataset_id': existing_dataset.id,
                        'created_at': existing_dataset.created_at.strftime("%B %d, %Y %I:%M %p"),
                        'data_size': len(existing_dataset.raw_data),
                        'date_range': date_range_str,
                        'oldest_game_date': existing_dataset.oldest_game_date.strftime("%B %d, %Y") if existing_dataset.oldest_game_date else None,
                        'newest_game_date': existing_dataset.newest_game_date.strftime("%B %d, %Y") if existing_dataset.newest_game_date else None,
                        'elo_ratings': elo_by_time_control,
                        'ndjson_data': existing_dataset.raw_data
                    }
                else:
                    # No existing unanalyzed dataset, but since_timestamp was provided
                    # This means user is checking for new games after generating a report
                    # Return success with 0 games found
                    print(f"No new games found since {since_timestamp}, and all datasets are analyzed")
                    return {
                        'success': False,
                        'error': 'No new games found since your last analyzed dataset. Play some more games and try again!'
                    }
            else:
                # Initial fetch with no games found - this is an error
                return {
                    'success': False,
                    'error': 'No rated bullet, blitz, or rapid games found for this account'
                }

        # Track dates
        # IMPORTANT: Use lastMoveAt because Lichess API's 'since' parameter filters by lastMoveAt
        oldest_date, newest_date = track_game_dates(
            games,
            lambda game: game.get('lastMoveAt')
        )

        # Update progress
        self.update_state(
            state='PROGRESS',
            meta={'current': 80, 'total': 100, 'status': 'Saving game data...'}
        )

        # Update existing dataset or create new one
        if existing_dataset:
            print(f"Updating existing dataset {existing_dataset.id} with {len(games)} new games")
            game_dataset = update_game_dataset(
                existing_dataset,
                games,
                filtered_ndjson_data,
                platform='lichess'
            )
        else:
            # Create new GameDataSet
            game_dataset = create_game_dataset(
                user=user,
                username=username,
                games_data=games,
                ndjson_data=filtered_ndjson_data,
                platform='lichess'
            )

        # Format date range
        date_range_str = format_date_range_for_display(
            game_dataset.oldest_game_date,
            game_dataset.newest_game_date
        )

        # Get latest ELO ratings by time control (use updated dataset's data)
        elo_by_time_control = get_latest_elo_by_time_control(
            game_dataset.raw_data,
            username,
            'lichess'
        )

        # Final update
        self.update_state(
            state='PROGRESS',
            meta={'current': 100, 'total': 100, 'status': 'Complete!'}
        )

        return {
            'success': True,
            'games_count': game_dataset.total_games,
            'game_dataset_id': game_dataset.id,
            'created_at': game_dataset.created_at.strftime("%B %d, %Y %I:%M %p"),
            'data_size': len(game_dataset.raw_data),
            'date_range': date_range_str,
            'oldest_game_date': game_dataset.oldest_game_date.strftime("%B %d, %Y") if game_dataset.oldest_game_date else None,
            'newest_game_date': game_dataset.newest_game_date.strftime("%B %d, %Y") if game_dataset.newest_game_date else None,
            'elo_ratings': elo_by_time_control,
            'ndjson_data': game_dataset.raw_data
        }

    except Exception as e:
        print(f"Error in fetch_lichess_games_task: {e}")
        # Retry the task if it fails
        raise self.retry(exc=e, countdown=60)  # Retry after 1 minute


@shared_task(bind=True, max_retries=3)
def fetch_daily_puzzle_task(self):
    """
    Background task to fetch Chess.com daily puzzle with serial access rate limiting

    This task ensures we don't hit Chess.com's rate limits by using the same
    Redis lock mechanism as other Chess.com API calls.

    Returns:
        Dictionary with puzzle data or None if failed
    """
    from chessdotcom import get_current_daily_puzzle
    from .views import extract_solution_from_pgn, get_last_move_from_chess_com_pgn

    try:
        # Update task state
        self.update_state(
            state='PROGRESS',
            meta={'status': 'Fetching daily puzzle from Chess.com...'}
        )

        # Acquire lock for Chess.com API (ensures serial access)
        wait_for_api_access()

        try:
            # Fetch daily puzzle from Chess.com
            response = get_current_daily_puzzle()

            if response and response.puzzle:
                puzzle = response.puzzle

                # Extract solution moves from PGN
                solution_moves = extract_solution_from_pgn(puzzle.pgn)

                # Get the last move from the PGN (the move that led to the puzzle position)
                last_move = get_last_move_from_chess_com_pgn(puzzle.pgn, puzzle.fen)

                puzzle_data = {
                    'title': puzzle.title or 'Chess.com Daily Puzzle',
                    'fen': puzzle.fen,
                    'pgn': puzzle.pgn,
                    'url': puzzle.url,
                    'image': puzzle.image,
                    'solution': solution_moves,
                    'publish_time': puzzle.publish_time,
                    'publish_datetime': getattr(puzzle, 'publish_datetime', None),
                    'source': 'chess.com',
                    'lastMove': last_move
                }

                print(f"✓ Successfully fetched daily puzzle from Chess.com")
                return puzzle_data
            else:
                print("❌ No puzzle data in Chess.com response")
                return None

        finally:
            # Always release the lock
            release_chess_com_api_lock()

    except Exception as e:
        print(f"❌ Error fetching daily puzzle: {e}")
        # Release lock in case of error
        release_chess_com_api_lock()
        # Don't retry - return None to trigger fallback
        return None


@shared_task(bind=True, max_retries=3)
def fetch_lichess_daily_puzzle_task(self):
    """
    Background task to fetch Lichess daily puzzle with serial access rate limiting

    This task ensures we don't hit Lichess's rate limits by using the same
    Redis lock mechanism as other Lichess API calls.

    Returns:
        Dictionary with puzzle data or None if failed
    """
    import requests

    try:
        # Update task state
        self.update_state(
            state='PROGRESS',
            meta={'status': 'Fetching daily puzzle from Lichess...'}
        )

        # Acquire lock for Lichess API (ensures serial access)
        wait_for_lichess_api_access()

        try:
            # Fetch daily puzzle from Lichess
            response = requests.get(
                "https://lichess.org/api/puzzle/daily",
                headers={
                    "Accept": "application/json"
                },
                timeout=10
            )

            # Check for 429 rate limit
            if response.status_code == 429:
                mark_lichess_429_received()
                release_lichess_api_lock()
                raise self.retry(exc=Exception("429 rate limit"), countdown=LICHESS_RATE_LIMIT_WAIT)

            if response.status_code != 200:
                release_lichess_api_lock()
                return {
                    'success': False,
                    'error': f'Lichess API returned status {response.status_code}'
                }

            puzzle_data = response.json()

            if not puzzle_data:
                release_lichess_api_lock()
                return {
                    'success': False,
                    'error': 'No puzzle data in Lichess response'
                }

            # Import helper functions for processing Lichess puzzle data
            from .views import convert_uci_to_algebraic, get_position_fen_from_pgn

            # Extract puzzle data from Lichess response
            lichess_puzzle = puzzle_data.get('puzzle', {})
            lichess_game = puzzle_data.get('game', {})
            pgn = lichess_game.get('pgn', '')
            initial_ply = lichess_puzzle.get('initialPly', 0)
            uci_solution = lichess_puzzle.get('solution', [])

            # Convert UCI moves to algebraic notation
            solution_moves = convert_uci_to_algebraic(uci_solution, pgn, initial_ply)

            # Calculate FEN position at the puzzle start
            puzzle_fen = get_position_fen_from_pgn(pgn, initial_ply)

            # Extract puzzle information
            puzzle = {
                'id': lichess_puzzle.get('id'),
                'title': f"Lichess Daily Puzzle - Rating {lichess_puzzle.get('rating', 'N/A')}",
                'fen': puzzle_fen,
                'solution': solution_moves,
                'url': f"https://lichess.org/training/{lichess_puzzle.get('id')}",
                'rating': lichess_puzzle.get('rating'),
                'plays': lichess_puzzle.get('plays'),
                'themes': lichess_puzzle.get('themes', []),
                'source': 'lichess',
                'lastMove': None  # Don't highlight last move for cleaner puzzle presentation
            }

            print(f"✓ Successfully fetched daily puzzle from Lichess (ID: {puzzle['id']})")

            release_lichess_api_lock()

            return {
                'success': True,
                'puzzle': puzzle
            }

        except Exception as e:
            release_lichess_api_lock()
            # Check if it's a 429 error
            if '429' in str(e):
                mark_lichess_429_received()
                raise self.retry(exc=e, countdown=LICHESS_RATE_LIMIT_WAIT)
            raise

    except Exception as e:
        print(f"❌ Error fetching Lichess daily puzzle: {e}")
        # Release lock in case of error
        release_lichess_api_lock()
        # Retry the task
        raise self.retry(exc=e, countdown=60)


@shared_task
def cleanup_unanalyzed_datasets_task():
    """
    Periodic task to clean up unanalyzed game datasets older than 24 hours.

    This prevents accumulation of unused datasets and ensures users can
    always fetch fresh games without being blocked by old, unused datasets.

    Should be run periodically (e.g., every hour) via Celery Beat.
    """
    from django.utils import timezone
    from datetime import timedelta
    from .models import GameDataSet

    try:
        # Find datasets that are:
        # 1. Not analyzed (analysis_generated=False)
        # 2. Created more than 24 hours ago
        cutoff_time = timezone.now() - timedelta(hours=24)

        old_unanalyzed = GameDataSet.objects.filter(
            analysis_generated=False,
            created_at__lt=cutoff_time
        )

        count = old_unanalyzed.count()
        if count > 0:
            print(f"Deleting {count} unanalyzed datasets older than 24 hours")
            old_unanalyzed.delete()
            print(f"✅ Successfully deleted {count} old unanalyzed datasets")
        else:
            print("No old unanalyzed datasets to delete")

        return {
            'success': True,
            'deleted_count': count
        }

    except Exception as e:
        print(f"❌ Error cleaning up unanalyzed datasets: {e}")
        return {
            'success': False,
            'error': str(e)
        }


@shared_task(bind=True, max_retries=3, autoretry_for=(Exception,), retry_backoff=True)
def write_evaluations_to_database_task(self, evaluations_json: str):
    """
    Background task to write position evaluations to Digital Ocean PostgreSQL database

    This task runs asynchronously so users don't have to wait for database writes.
    New evaluations from GCP Stockfish API are queued for write-back to the database
    to build up the evaluation cache over time.

    Args:
        evaluations_json: JSON string of evaluations dict mapping FEN -> evaluation data

    Returns:
        Dictionary with write statistics
    """
    import logging
    logger = logging.getLogger(__name__)

    try:
        # Parse evaluations from JSON
        evaluations = json.loads(evaluations_json)

        if not evaluations:
            logger.info("No evaluations to write (empty dict)")
            return {'success': True, 'count': 0}

        # Import database evaluator
        from .chess_analysis.database_evaluator import DatabaseEvaluator
        db_evaluator = DatabaseEvaluator()

        # Write evaluations in batch (optimized for bulk operations)
        logger.info(f"Starting async write of {len(evaluations)} evaluations to database")
        success_count = db_evaluator.write_evaluations_batch(evaluations)

        if success_count > 0:
            logger.info(f"Successfully wrote {success_count} evaluations to database")
            print(f"✅ ASYNC DATABASE WRITE: {success_count} evaluations written")
        else:
            logger.warning("Database write completed but no evaluations were written")

        return {
            'success': True,
            'count': success_count,
            'total_requested': len(evaluations)
        }

    except Exception as e:
        logger.error(f"Error writing evaluations to database: {e}")
        # Celery will automatically retry with exponential backoff
        raise self.retry(exc=e, countdown=60)


@shared_task
def reset_monthly_usage_counters():
    """
    Reset games_analyzed_this_month counter for all users.
    This task should be scheduled to run on the 1st of each month.
    """
    from .models import UserProfile
    from django.utils import timezone

    today = timezone.now().date()

    # Get all user profiles that have active subscriptions
    profiles = UserProfile.objects.filter(subscription_status='active')

    reset_count = 0
    for profile in profiles:
        # Reset the counter
        profile.games_analyzed_this_month = 0
        profile.usage_reset_date = today
        profile.save()
        reset_count += 1

    print(f"✅ Reset usage counters for {reset_count} users on {today}")
    return {
        'success': True,
        'reset_count': reset_count,
        'date': str(today)
    }
