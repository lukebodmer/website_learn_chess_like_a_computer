from django.shortcuts import render, redirect, get_object_or_404
from django.contrib.auth.decorators import login_required
from django.contrib.auth import login, logout, update_session_auth_hash
from django.contrib.auth.forms import UserCreationForm
from django.contrib.auth.models import User
from .forms import CustomPasswordChangeForm
from django.http import HttpResponse, JsonResponse
from django.conf import settings
from django.urls import reverse
from django.utils import timezone
from django.contrib import messages
from django.db import models
from datetime import datetime, timedelta
import os
import base64
import hashlib
import secrets
import urllib.parse
import requests
import json
import tempfile
import pycountry
import pytz
import time

from .models import UserProfile, GameDataSet, AnalysisReport, ReportGenerationTask, SolvedBlunder, SolvedPuzzle
from chessdotcom import get_player_profile, get_player_game_archives, get_player_games_by_month, get_current_daily_puzzle, ChessDotComClient, RateLimitHandler
from django.core.cache import cache
from .chess_analysis import ChessAnalyzer
from .chess_analysis.game_enricher import GameEnricher
from django.http import StreamingHttpResponse
from .report_generation import generate_html_report
from .opening_classifier import classify_opening_by_moves, lookup_opening_in_database


# Number of games to analyze (change this to analyze more/fewer games)
ANALYSIS_GAME_COUNT = 100


# Configure Chess.com client with rate limit handling
# This client will automatically:
# - Wait 4 seconds between retries after a 429 rate limit response
# - Retry failed requests up to 2 times
# - Use a proper User-Agent header
chess_com_client = ChessDotComClient(
    user_agent="Learn Chess Like a Computer - Chess Analysis Tool. Contact: learnchesslikeacomputer@gmail.com",
    rate_limit_handler=RateLimitHandler(
        tts=4,      # Wait 4 seconds between retries after 429
        retries=2   # Retry up to 2 times
    )
)


# Shared utilities for game fetching
def format_date_range_for_display(oldest_date, newest_date):
    """Format date range for display"""
    if not oldest_date or not newest_date:
        return None

    oldest_str = oldest_date.strftime("%B %d, %Y")
    newest_str = newest_date.strftime("%B %d, %Y")

    if oldest_str == newest_str:
        return oldest_str  # Same day
    else:
        return f"{oldest_str} - {newest_str}"


def track_game_dates(games_data, date_field_extractor):
    """Track oldest and newest game dates from games data

    Args:
        games_data: List of games
        date_field_extractor: Function that takes a game and returns the timestamp
    """
    oldest_date = None
    newest_date = None

    for game in games_data:
        try:
            timestamp = date_field_extractor(game)
            if timestamp:
                if isinstance(timestamp, (int, float)):
                    # Convert timestamp to datetime
                    game_date = datetime.fromtimestamp(timestamp / 1000 if timestamp > 1000000000000 else timestamp, tz=timezone.utc)
                else:
                    game_date = timestamp

                if newest_date is None or game_date > newest_date:
                    newest_date = game_date
                if oldest_date is None or game_date < oldest_date:
                    oldest_date = game_date
        except:
            continue

    return oldest_date, newest_date


def create_game_dataset(user, username, games_data, ndjson_data, platform='lichess'):
    """Create a GameDataSet with proper date tracking"""
    # Extract dates based on platform
    if platform == 'lichess':
        oldest_date, newest_date = track_game_dates(
            games_data,
            lambda game: game.get('createdAt')
        )
    else:  # chess.com
        # Handle both dictionary format and object format
        oldest_date, newest_date = track_game_dates(
            games_data,
            lambda game: game.get('end_time', 0) if isinstance(game, dict) else getattr(game, 'end_time', 0)
        )

    # Create dataset with proper fields based on platform
    dataset_kwargs = {
        'user': user,
        'total_games': len(games_data),
        'raw_data': ndjson_data,
        'oldest_game_date': oldest_date,
        'newest_game_date': newest_date
    }

    if platform == 'lichess':
        dataset_kwargs.update({
            'lichess_username': username,
            'chess_com_username': ''
        })
    else:  # chess.com
        dataset_kwargs.update({
            'lichess_username': '',
            'chess_com_username': username
        })

    return GameDataSet.objects.create(**dataset_kwargs)


# OAuth helper functions (from Flask version)
def base64_url_encode(data):
    return base64.urlsafe_b64encode(data).decode().rstrip("=")


def create_code_verifier():
    return base64_url_encode(secrets.token_bytes(32))


def create_code_challenge(verifier):
    digest = hashlib.sha256(verifier.encode()).digest()
    return base64_url_encode(digest)


def get_lichess_token(auth_code, verifier, redirect_uri):
    response = requests.post(
        "https://lichess.org/api/token",
        json={
            "grant_type": "authorization_code",
            "redirect_uri": redirect_uri,
            "client_id": settings.LICHESS_CLIENT_ID,
            "code": auth_code,
            "code_verifier": verifier,
        },
    )
    return response.json()


def get_lichess_user(access_token):
    response = requests.get(
        "https://lichess.org/api/account",
        headers={"Authorization": f"Bearer {access_token}"},
    )
    return response.json()


def home(request):
    """Home page"""
    context = {}

    if request.user.is_authenticated:
        # Get user's recent reports with additional data
        reports = AnalysisReport.objects.filter(
            game_dataset__user=request.user
        ).select_related('game_dataset').order_by('-created_at')[:5]

        # Add date range information for each report
        enriched_reports = []
        for report in reports:
            # Use stored date range from GameDataSet model
            report.date_range_start = report.game_dataset.oldest_game_date
            report.date_range_end = report.game_dataset.newest_game_date
            # Determine platform based on GameDataSet
            if report.game_dataset.lichess_username:
                report.platform = 'Lichess'
                report.username = report.game_dataset.lichess_username
            elif report.game_dataset.chess_com_username:
                report.platform = 'Chess.com'
                report.username = report.game_dataset.chess_com_username
            else:
                report.platform = 'Unknown'
                report.username = 'Unknown'
            enriched_reports.append(report)

        context['reports'] = enriched_reports

    return render(request, 'analysis/home.html', context)


def signup(request):
    """User registration page"""
    if request.user.is_authenticated:
        return redirect('analysis:home')

    if request.method == 'POST':
        form = UserCreationForm(request.POST)
        if form.is_valid():
            user = form.save()
            login(request, user)
            messages.success(request, f"Welcome {user.username}! Your account has been created.")
            return redirect('analysis:home')
    else:
        form = UserCreationForm()

    return render(request, 'registration/signup.html', {'form': form})


def games(request):
    """Games page with interactive chess mini-games"""
    return render(request, 'analysis/games.html')


def learn(request):
    """Learn page"""
    return render(request, 'analysis/learn.html')


def learn_openings(request):
    """Learn about openings"""
    return render(request, 'analysis/learn/openings.html')


def learn_evaluations(request):
    """Learn about how evaluations work"""
    return render(request, 'analysis/learn/evaluations.html')


def learn_cheating(request):
    """Learn about how cheating is detected"""
    return render(request, 'analysis/learn/cheating.html')


def learn_chess_data(request):
    """Learn about how chess data works"""
    return render(request, 'analysis/learn/chess_data.html')


def lichess_login(request):
    """Initiate Lichess OAuth flow or redirect to analysis if already connected"""
    # Check if user is authenticated and already has a connected Lichess account
    if request.user.is_authenticated:
        try:
            profile = UserProfile.objects.get(user=request.user)
            if profile.lichess_username and profile.lichess_access_token:
                # User is already connected, redirect directly to analysis
                return redirect('analysis:generate_report_page', platform='lichess', username=profile.lichess_username)
        except UserProfile.DoesNotExist:
            pass  # Continue with OAuth flow

    base_url = request.build_absolute_uri('/').rstrip('/')

    verifier = create_code_verifier()
    challenge = create_code_challenge(verifier)
    state = secrets.token_urlsafe(32)

    request.session['code_verifier'] = verifier
    request.session['oauth_state'] = state

    params = {
        "response_type": "code",
        "client_id": settings.LICHESS_CLIENT_ID,
        "redirect_uri": f"{base_url}/lichess/callback/",
        "code_challenge_method": "S256",
        "code_challenge": challenge,
        "state": state,
    }

    auth_url = f"https://lichess.org/oauth?{urllib.parse.urlencode(params)}"
    return redirect(auth_url)


def lichess_callback(request):
    """Handle Lichess OAuth callback"""
    error = request.GET.get("error")
    if error:
        error_desc = request.GET.get("error_description", "Unknown error")
        return HttpResponse(f"Authorization failed: {error_desc}", status=400)

    code = request.GET.get("code")
    state = request.GET.get("state")

    if not code:
        return HttpResponse("Authorization failed: no code received", status=400)

    # CSRF protection
    stored_state = request.session.get("oauth_state")
    if not stored_state or state != stored_state:
        return HttpResponse("Invalid state parameter - possible CSRF attack", status=400)

    verifier = request.session.get("code_verifier")
    if not verifier:
        return HttpResponse("Session expired", status=400)

    base_url = request.build_absolute_uri('/').rstrip('/')
    redirect_uri = f"{base_url}/lichess/callback/"

    try:
        token_data = get_lichess_token(code, verifier, redirect_uri)

        if not token_data.get("access_token"):
            return HttpResponse("Failed to get access token", status=400)

        access_token = token_data["access_token"]
        user_data = get_lichess_user(access_token)
        lichess_username = user_data["username"]

        # Create or update user profile
        if request.user.is_authenticated:
            profile, created = UserProfile.objects.get_or_create(user=request.user)
            profile.lichess_username = lichess_username
            profile.lichess_access_token = access_token
            profile.save()
        else:
            # Store in session for now
            request.session['access_token'] = access_token
            request.session['lichess_username'] = lichess_username

        # Clean up OAuth session data
        request.session.pop('code_verifier', None)
        request.session.pop('oauth_state', None)

        return redirect('analysis:generate_report_page', platform='lichess', username=lichess_username)

    except Exception as e:
        return HttpResponse(f"Authentication error: {str(e)}", status=500)


@login_required
def generate_report_page(request, platform, username):
    """Unified report generation page for both Lichess and Chess.com"""
    if platform == 'lichess':
        # Verify Lichess authentication
        profile = get_object_or_404(UserProfile, user=request.user, lichess_username=username)
        access_token = profile.lichess_access_token

        if not access_token:
            messages.error(request, "No valid Lichess authentication found")
            return redirect('analysis:lichess_login')
    elif platform == 'chess.com':
        # Verify Chess.com account
        profile = get_object_or_404(UserProfile, user=request.user, chess_com_username=username)
    else:
        return HttpResponse("Invalid platform", status=400)

    # Render unified page with React component
    return render(request, 'analysis/generate_report.html', {
        'username': username,
        'platform': platform
    })

@login_required
def get_last_dataset(request, platform, username):
    """Get the most recent dataset for a given platform and username"""
    try:
        # Find the most recent dataset for this user and platform
        if platform == 'lichess':
            last_dataset = GameDataSet.objects.filter(
                user=request.user,
                lichess_username=username
            ).order_by('-created_at').first()
        elif platform == 'chess.com':
            last_dataset = GameDataSet.objects.filter(
                user=request.user,
                chess_com_username=username
            ).order_by('-created_at').first()
        else:
            return JsonResponse({
                'success': False,
                'error': 'Invalid platform'
            })

        if not last_dataset:
            return JsonResponse({
                'success': True,
                'has_previous_dataset': False,
                'message': 'No previous datasets found'
            })

        # Return dataset information
        return JsonResponse({
            'success': True,
            'has_previous_dataset': True,
            'dataset_id': last_dataset.id,
            'total_games': last_dataset.total_games,
            'created_at': last_dataset.created_at.strftime("%B %d, %Y at %I:%M %p"),
            'oldest_game_date': last_dataset.oldest_game_date.isoformat() if last_dataset.oldest_game_date else None,
            'newest_game_date': last_dataset.newest_game_date.isoformat() if last_dataset.newest_game_date else None,
            'date_range': last_dataset.date_range_display
        })

    except Exception as e:
        return JsonResponse({
            'success': False,
            'error': str(e)
        })


@login_required
def fetch_lichess_games(request, username):
    """AJAX endpoint to dispatch Celery task for fetching Lichess games"""
    # Get access token
    profile = get_object_or_404(UserProfile, user=request.user, lichess_username=username)
    access_token = profile.lichess_access_token

    if not access_token:
        return JsonResponse({
            'success': False,
            'error': 'No valid Lichess authentication found'
        })

    try:
        # Get max_games from request (default to analysis setting)
        max_games = int(request.GET.get('max_games', ANALYSIS_GAME_COUNT))

        # Validate max_games to prevent abuse
        if max_games < 1 or max_games > 1000:
            max_games = ANALYSIS_GAME_COUNT

        # Get the 'since' parameter (timestamp of newest game in last dataset)
        # Frontend sends milliseconds, which is what Lichess API expects
        since_timestamp = request.GET.get('since', None)
        if since_timestamp:
            since_timestamp = int(since_timestamp)

        # Import the task
        from .tasks import fetch_lichess_games_task

        # Dispatch Celery task to fetch games in background
        task = fetch_lichess_games_task.apply_async(
            args=[request.user.id, username, access_token, max_games, since_timestamp],
            queue='lichess_api'
        )

        # Return task ID so frontend can poll for status
        return JsonResponse({
            'success': True,
            'task_id': task.id,
            'status': 'started',
            'message': 'Game fetch started in background. Please wait...'
        })

    except Exception as e:
        return JsonResponse({
            'success': False,
            'error': str(e)
        })


def get_latest_elo_by_time_control(raw_data, username, platform):
    """Extract the latest ELO rating for each time control (bullet, blitz, rapid) from raw game data

    Args:
        raw_data: NDJSON string of raw game data
        username: The username to get ELO for
        platform: 'lichess' or 'chess.com'

    Returns:
        Dictionary with time controls as keys and ELO ratings as values
        Example: {'bullet': 1377, 'blitz': 783, 'rapid': 878}
    """
    if not raw_data or not username:
        return {}

    username_lower = username.lower()
    elo_by_time_control = {}

    try:
        lines = raw_data.strip().split('\n')

        # Process games in order (most recent first for Lichess, need to reverse for Chess.com)
        for line in lines:
            if not line.strip():
                continue

            try:
                game_data = json.loads(line)

                # Extract time control based on platform
                if platform == 'lichess':
                    time_control = game_data.get('speed', '').lower()
                else:  # chess.com
                    time_control = game_data.get('time_class', '').lower()

                # Only process bullet, blitz, rapid
                if time_control not in ['bullet', 'blitz', 'rapid']:
                    continue

                # Skip if we already have ELO for this time control
                if time_control in elo_by_time_control:
                    continue

                # Extract player ELO based on platform
                user_elo = None

                if platform == 'lichess':
                    # Lichess format
                    players = game_data.get('players', {})
                    white_player = players.get('white', {})
                    black_player = players.get('black', {})

                    white_username = white_player.get('user', {}).get('name', '').lower()
                    black_username = black_player.get('user', {}).get('name', '').lower()

                    if white_username == username_lower:
                        user_elo = white_player.get('rating')
                    elif black_username == username_lower:
                        user_elo = black_player.get('rating')
                else:  # chess.com
                    # Chess.com format
                    white_data = game_data.get('white', {})
                    black_data = game_data.get('black', {})

                    white_username = white_data.get('username', '').lower()
                    black_username = black_data.get('username', '').lower()

                    if white_username == username_lower:
                        user_elo = white_data.get('rating')
                    elif black_username == username_lower:
                        user_elo = black_data.get('rating')

                # Store the ELO if found and valid
                if user_elo and user_elo > 0:
                    elo_by_time_control[time_control] = user_elo

                # Stop if we have all three time controls
                if len(elo_by_time_control) == 3:
                    break

            except json.JSONDecodeError:
                continue
    except Exception as e:
        print(f"Error extracting ELO by time control: {e}")

    return elo_by_time_control


def load_elo_averages_for_time_controls(elo_by_time_control):
    """Load ELO averages data for each time control based on user's ratings

    Args:
        elo_by_time_control: Dictionary with time controls and ELO ratings
                            Example: {'bullet': 1377, 'blitz': 783, 'rapid': 878}

    Returns:
        Dictionary with structure:
        {
            'bullet': { 'bracket': '1300-1400', 'data': {...} },
            'blitz': { 'bracket': '700-800', 'data': {...} },
            'rapid': { 'bracket': '800-900', 'data': {...} }
        }
    """
    result = {}

    for time_control, elo_rating in elo_by_time_control.items():
        # Determine bracket for this ELO (100-point buckets)
        if elo_rating < 600:
            bracket = 'below-600'
        elif elo_rating >= 2400:
            bracket = '2400+'
        else:
            # Round down to nearest 100 and create bracket
            lower_bound = (elo_rating // 100) * 100
            upper_bound = lower_bound + 100
            bracket = f'{lower_bound}-{upper_bound}'

        # Load the JSON file for this bracket
        try:
            from django.conf import settings
            json_path = os.path.join(settings.BASE_DIR, 'static', 'data', 'elo_averages', f'{bracket}.json')

            if os.path.exists(json_path):
                with open(json_path, 'r') as f:
                    bracket_data = json.load(f)

                # Extract data for this specific time control
                time_control_data = bracket_data.get(time_control, {})

                result[time_control] = {
                    'bracket': bracket,
                    'elo': elo_rating,
                    'data': time_control_data
                }
            else:
                print(f"ELO averages file not found: {json_path}")
        except Exception as e:
            print(f"Error loading ELO averages for {time_control} at bracket {bracket}: {e}")

    return result


def load_opening_stats_for_elo(elo_by_time_control):
    """Load opening statistics based on user's ELO rating for each time control

    For each time control, determines the appropriate ELO bracket and loads the
    corresponding opening stats for that bracket.

    Args:
        elo_by_time_control: Dictionary with time controls and ELO ratings
                            Example: {'bullet': 1377, 'blitz': 1248, 'rapid': 878}

    Returns:
        Dictionary with opening stats organized by time control, or None if not found
        Example: {
            'bullet': {
                'Sicilian Defense': {
                    'eco': 'B20',
                    'sample_size': 1000,
                    'number_of_times_played': 12375,
                    'opening_inaccuracies_per_game': {...},
                    ...
                }
            },
            'blitz': {...},
            'rapid': {...}
        }
    """
    if not elo_by_time_control:
        return None

    from django.conf import settings

    # Result dictionary to hold opening stats for each time control
    result = {}

    # For each time control, load the appropriate bracket file
    for time_control, elo in elo_by_time_control.items():
        # Determine bracket for this ELO (100-point buckets)
        if elo < 600:
            bracket = 'below-600'
        elif elo >= 2400:
            bracket = '2400+'
        else:
            # Round down to nearest 100 and create bracket
            lower_bound = (int(elo) // 100) * 100
            upper_bound = lower_bound + 100
            bracket = f'{lower_bound}-{upper_bound}'

        # Load the opening stats JSON file for this bracket
        try:
            json_path = os.path.join(settings.BASE_DIR, 'static', 'data', 'top_100_opening_stats', f'{bracket}.json')

            if os.path.exists(json_path):
                with open(json_path, 'r') as f:
                    bracket_data = json.load(f)

                # Extract just the data for this time control from the bracket file
                if time_control in bracket_data:
                    result[time_control] = bracket_data[time_control]
                else:
                    print(f"Warning: Time control '{time_control}' not found in {json_path}")
            else:
                print(f"Opening stats file not found: {json_path}")
        except Exception as e:
            print(f"Error loading opening stats for bracket {bracket}, time control {time_control}: {e}")
            import traceback
            traceback.print_exc()

    # Return None if we didn't load any data
    return result if result else None


def _render_completed_report(request, report, platform, username, game_dataset):
    """Render a completed analysis report"""
    # Get enriched games for JavaScript components
    enriched_games_display = "No enriched game data available"
    if report.enriched_games:
        enriched_games_display = json.dumps(report.enriched_games, indent=2)

    # Get stockfish analysis (including principles) for display
    stockfish_analysis_display = "{}"
    principles_data_display = "{}"
    if report.stockfish_analysis:
        stockfish_analysis_display = json.dumps(report.stockfish_analysis, indent=2)
        # Extract just the principles data for the PrinciplesSummary component
        if 'principles' in report.stockfish_analysis:
            principles_data_display = json.dumps(report.stockfish_analysis['principles'], indent=2)

    # Get custom puzzles for display
    custom_puzzles_display = "[]"
    if report.custom_puzzles:
        custom_puzzles_display = json.dumps(report.custom_puzzles, indent=2)

    # Load ELO averages data based on user's ratings by time control
    elo_averages_data = "{}"
    opening_stats_data = "{}"
    if game_dataset.raw_data:
        elo_by_time_control = get_latest_elo_by_time_control(
            game_dataset.raw_data,
            username,
            platform
        )
        if elo_by_time_control:
            elo_averages = load_elo_averages_for_time_controls(elo_by_time_control)
            if elo_averages:
                elo_averages_data = json.dumps(elo_averages, indent=2)

            # Load opening stats separately
            opening_stats = load_opening_stats_for_elo(elo_by_time_control)
            if opening_stats:
                opening_stats_data = json.dumps(opening_stats, indent=2)

    # Get ELO chart data from report
    elo_chart_data_display = "[]"
    if report.elo_chart_data:
        elo_chart_data_display = json.dumps(report.elo_chart_data, indent=2)

    # Prepare LLM insights for template
    llm_insights_display = "{}"
    if report.llm_insights:
        llm_insights_display = json.dumps(report.llm_insights, indent=2)

    return render(request, 'analysis/report.html', {
        'username': username,
        'dataset_id': game_dataset.id,
        'report_id': report.id,
        'enriched_games': enriched_games_display,
        'stockfish_analysis': stockfish_analysis_display,
        'principles_data': principles_data_display,
        'custom_puzzles': custom_puzzles_display,
        'elo_averages': elo_averages_data,
        'opening_stats': opening_stats_data,
        'elo_chart_data': elo_chart_data_display,
        'llm_insights': llm_insights_display,
        'auto_start': False,  # Don't auto-start streaming for existing reports
        'platform': platform
    })

def _generate_unified_analysis_report(request, username, dataset_id):
    """Unified report generation for both Lichess and Chess.com data"""
    # Get the dataset and auto-detect platform
    game_dataset = get_object_or_404(GameDataSet, id=dataset_id, user=request.user)

    # Verify username matches dataset and determine platform
    if game_dataset.lichess_username == username:
        platform = 'lichess'
        error_message = "No games data found. Please connect your Lichess account first."
    elif game_dataset.chess_com_username == username:
        platform = 'chess.com'
        error_message = "No Chess.com games data found. Please connect your Chess.com account and fetch games first."
    else:
        return HttpResponse("Username does not match dataset", status=400)

    if not game_dataset:
        return HttpResponse(error_message, status=404)

    # Check if there's already a pending or running task for this dataset
    existing_task = ReportGenerationTask.objects.filter(
        user=request.user,
        game_dataset=game_dataset,
        status__in=['pending', 'running']
    ).first()

    if not existing_task:
        # Check if there's already a completed report
        existing_report = AnalysisReport.objects.filter(
            user=request.user,
            game_dataset=game_dataset
        ).first()

        if not existing_report:
            # Create a new background task
            task = ReportGenerationTask.objects.create(
                user=request.user,
                game_dataset=game_dataset,
                status='pending'
            )
            print(f"📊 Created new report generation task {task.id} for {platform} user {username}")

            # Start the task processor if not running
            from .task_processor import start_task_processor
            start_task_processor()
        else:
            print(f"📊 Report already exists for {platform} user {username}, showing existing report")
            # Return completed report immediately
            return _render_completed_report(request, existing_report, platform, username, game_dataset)

    # Load ELO averages data based on user's ratings by time control
    elo_averages_data = "{}"
    opening_stats_data = "{}"
    if game_dataset.raw_data:
        elo_by_time_control = get_latest_elo_by_time_control(
            game_dataset.raw_data,
            username,
            platform
        )
        if elo_by_time_control:
            elo_averages = load_elo_averages_for_time_controls(elo_by_time_control)
            if elo_averages:
                elo_averages_data = json.dumps(elo_averages, indent=2)

            # Load opening stats separately
            opening_stats = load_opening_stats_for_elo(elo_by_time_control)
            if opening_stats:
                opening_stats_data = json.dumps(opening_stats, indent=2)

    # Get ELO chart data from game dataset if available
    elo_chart_data_display = "[]"
    if game_dataset.elo_chart_data:
        elo_chart_data_display = json.dumps(game_dataset.elo_chart_data, indent=2)

    # Show the unified report page
    return render(request, 'analysis/report.html', {
        'username': username,
        'dataset_id': dataset_id,
        'enriched_games': json.dumps({"status": "Waiting for analysis to complete..."}, indent=2),
        'stockfish_analysis': json.dumps({}),  # Empty initially, will be populated during streaming
        'principles_data': json.dumps({}),  # Empty initially, will be populated during streaming
        'custom_puzzles': json.dumps([]),  # Empty initially, will be populated after analysis
        'elo_averages': elo_averages_data,
        'opening_stats': opening_stats_data,
        'elo_chart_data': elo_chart_data_display,
        'auto_start': True,  # Tell template to auto-start streaming
        'platform': platform  # Tell template which platform this is
    })

@login_required
def generate_analysis_report(request, username, dataset_id):
    """Generate analysis report using unified template (auto-detects platform)"""
    return _generate_unified_analysis_report(request, username, dataset_id)

@login_required
def stream_analysis_progress(request, username, dataset_id):
    """Stream real-time analysis progress by monitoring background task"""
    try:
        # Get the specific game dataset for this user
        game_dataset = get_object_or_404(GameDataSet, id=dataset_id, user=request.user)

        # Verify username matches the dataset
        if not (game_dataset.lichess_username == username or game_dataset.chess_com_username == username):
            return HttpResponse("Username does not match dataset", status=400)

        if not game_dataset.raw_data:
            return HttpResponse("No games data found in dataset", status=404)

        def event_stream():
            try:
                # Find the task for this specific dataset
                task = ReportGenerationTask.objects.filter(
                    user=request.user,
                    game_dataset=game_dataset
                ).order_by('-created_at').first()

                print(f"DEBUG stream_analysis_progress: Using dataset {dataset_id}, found task={task.id if task else None}")
                if task:
                    print(f"DEBUG stream_analysis_progress: Task dataset - Lichess: {task.game_dataset.lichess_username}, Chess.com: {task.game_dataset.chess_com_username}")

                if not task:
                    # No task found, send error
                    error_data = {"type": "error", "error": "No analysis task found"}
                    yield f"data: {json.dumps(error_data)}\n\n"
                    return

                # Send initial status
                init_data = {
                    "type": "init",
                    "total_games": task.total_games if task.total_games > 0 else "calculating...",
                    "games_found": task.total_games if task.total_games > 0 else "calculating...",
                    "task_status": task.status
                }
                yield f"data: {json.dumps(init_data)}\n\n"

                # Monitor task progress and incremental game completion
                last_progress = -1
                last_status = task.status
                last_enriched_count = 0

                while not task.is_complete:
                    # Refresh task from database
                    task.refresh_from_db()

                    # Check for new completed games
                    if task.analysis_report:
                        task.analysis_report.refresh_from_db()
                        current_enriched_count = len(task.analysis_report.enriched_games) if task.analysis_report.enriched_games else 0

                        # Send individual game completions
                        if current_enriched_count > last_enriched_count:
                            # Send the newly completed games
                            newly_completed_games = task.analysis_report.enriched_games[last_enriched_count:current_enriched_count]

                            for i, game_data in enumerate(newly_completed_games):
                                game_complete_data = {
                                    "type": "game_complete",
                                    "game_index": last_enriched_count + i,
                                    "game_data": game_data,
                                    "completed_games": last_enriched_count + i + 1,
                                    "total_games": task.analysis_report.basic_stats.get('total_games', 0) if task.analysis_report.basic_stats else 0
                                }
                                yield f"data: {json.dumps(game_complete_data)}\n\n"

                            last_enriched_count = current_enriched_count

                    # Send progress updates
                    if task.progress != last_progress or task.status != last_status:
                        if task.status == 'running':
                            # Send API progress updates (format expected by frontend)
                            # Use exact call counts stored in task fields
                            progress_data = {
                                "type": "api_progress",
                                "completed_calls": task.completed_games,  # Repurposed for completed_calls
                                "total_calls": task.total_games,          # Repurposed for total_calls
                                "current_phase": task.current_game or "Processing..."
                            }
                            yield f"data: {json.dumps(progress_data)}\n\n"

                        last_progress = task.progress
                        last_status = task.status

                    time.sleep(0.5)  # Poll twice per second for more responsive game updates

                # Task completed, send final result
                if task.status == 'completed' and task.analysis_report:
                    # Send completion data with report summary
                    report = task.analysis_report

                    completion_data = {
                        "type": "complete",
                        "report_id": report.id,
                        "summary": {
                            "total_games_analyzed": report.stockfish_analysis.get('total_games_analyzed', 0),
                            "database_evaluations_used": report.stockfish_analysis.get('database_evaluations_used', 0),
                            "stockfish_evaluations_used": report.stockfish_analysis.get('stockfish_evaluations_used', 0),
                            "existing_evaluations_used": report.stockfish_analysis.get('existing_evaluations_used', 0),
                        },
                        "enriched_games_count": len(report.enriched_games) if report.enriched_games else 0,
                        "stockfish_analysis": report.stockfish_analysis,
                        "custom_puzzles": report.custom_puzzles if report.custom_puzzles else [],
                        "llm_insights": report.llm_insights if report.llm_insights else {}
                    }
                    yield f"data: {json.dumps(completion_data)}\n\n"

                elif task.status == 'failed':
                    error_data = {
                        "type": "error",
                        "error": f"Analysis failed: {task.error_message}"
                    }
                    yield f"data: {json.dumps(error_data)}\n\n"

            except Exception as e:
                error_data = {"type": "error", "error": str(e)}
                yield f"data: {json.dumps(error_data)}\n\n"

        response = StreamingHttpResponse(event_stream(), content_type='text/event-stream')
        response['Cache-Control'] = 'no-cache'
        response['X-Accel-Buffering'] = 'no'
        return response

    except Exception as e:
        return HttpResponse(f"Error starting stream: {str(e)}", status=500)


@login_required
def get_report_data(request, report_id):
    """API endpoint to fetch enriched games data from a completed report"""
    try:
        # Get the report and verify it belongs to the user
        report = get_object_or_404(AnalysisReport, id=report_id, user=request.user)

        # Debug: Log report details
        print(f"DEBUG get_report_data: Fetching report {report_id}")
        print(f"DEBUG get_report_data: Report dataset - Lichess: {report.game_dataset.lichess_username}, Chess.com: {report.game_dataset.chess_com_username}")
        print(f"DEBUG get_report_data: Enriched games count: {len(report.enriched_games) if report.enriched_games else 0}")

        if report.enriched_games and len(report.enriched_games) > 0:
            first_game = report.enriched_games[0]
            chess_com_data = first_game.get('chess_com_data')
            game_source = "Chess.com" if chess_com_data else "Lichess"
            game_id = first_game.get('id', 'unknown')
            print(f"DEBUG get_report_data: First enriched game - Source: {game_source}, ID: {game_id}")

        # Determine platform and username
        if report.game_dataset.lichess_username:
            platform = 'Lichess'
            username = report.game_dataset.lichess_username
        elif report.game_dataset.chess_com_username:
            platform = 'Chess.com'
            username = report.game_dataset.chess_com_username
        else:
            platform = 'Unknown'
            username = 'Unknown'

        return JsonResponse({
            'report': {
                'id': report.id,
                'platform': platform,
                'username': username,
                'created_at': report.created_at.isoformat(),
            },
            'report_id': report.id,
            'enriched_games': report.enriched_games,
            'games_count': len(report.enriched_games) if report.enriched_games else 0,
            'created_at': report.created_at.isoformat(),
            'analysis_summary': report.stockfish_analysis
        })

    except Exception as e:
        return JsonResponse({
            'error': f'Failed to fetch report data: {str(e)}'
        }, status=500)


@login_required
def get_user_reports_api(request):
    """API endpoint to fetch list of user reports"""
    try:
        reports = AnalysisReport.objects.filter(
            user=request.user
        ).select_related('game_dataset').order_by('-created_at')

        reports_list = []
        for report in reports:
            # Determine platform and username
            if report.game_dataset.lichess_username:
                platform = 'Lichess'
                username = report.game_dataset.lichess_username
            elif report.game_dataset.chess_com_username:
                platform = 'Chess.com'
                username = report.game_dataset.chess_com_username
            else:
                platform = 'Unknown'
                username = 'Unknown'

            # Format date range for title
            date_start = report.game_dataset.oldest_game_date
            date_end = report.game_dataset.newest_game_date

            if date_start and date_end:
                date_range = f"{date_start.strftime('%b %d, %Y')} - {date_end.strftime('%b %d, %Y')}"
            else:
                date_range = "Unknown dates"

            title = f"{username} ({platform}) - {date_range}"

            reports_list.append({
                'id': report.id,
                'title': title,
                'username': username,
                'platform': platform,
                'created_at': report.created_at.isoformat(),
                'games_count': len(report.enriched_games) if report.enriched_games else 0
            })

        return JsonResponse({
            'reports': reports_list
        })

    except Exception as e:
        return JsonResponse({
            'error': f'Failed to fetch reports: {str(e)}'
        }, status=500)


@login_required
def user_reports(request):
    """List all reports for the current user"""
    reports = AnalysisReport.objects.filter(
        user=request.user
    ).select_related('game_dataset').order_by('-created_at')

    # Add platform and date range information for each report
    enriched_reports = []
    for report in reports:
        # Use stored date range from GameDataSet model
        report.date_range_start = report.game_dataset.oldest_game_date
        report.date_range_end = report.game_dataset.newest_game_date

        # Determine platform based on GameDataSet
        if report.game_dataset.lichess_username:
            report.platform = 'Lichess'
            report.username = report.game_dataset.lichess_username
        elif report.game_dataset.chess_com_username:
            report.platform = 'Chess.com'
            report.username = report.game_dataset.chess_com_username
        else:
            report.platform = 'Unknown'
            report.username = 'Unknown'

        enriched_reports.append(report)

    return render(request, 'analysis/user_reports.html', {'reports': enriched_reports})


def custom_logout(request):
    """Custom logout view"""
    logout(request)
    return render(request, 'registration/logged_out.html')


@login_required
def chess_com_connect(request):
    """Connect chess.com account by showing profile information"""
    if request.method == 'POST':
        username = request.POST.get('chess_com_username', '').strip()

        if not username:
            messages.error(request, "Please enter a chess.com username.")
            return render(request, 'analysis/chess_com_connect.html', {'form_data': request.POST})

        try:
            # Get player profile from chess.com
            # User-Agent and rate limiting are handled by chess_com_client
            response = get_player_profile(username)

            if response.player:
                # Process the player profile data
                player = response.player

                # Extract country code from URL and convert to country name
                if player.country:
                    country_code = player.country.split('/')[-1]
                    try:
                        country = pycountry.countries.get(alpha_2=country_code)
                        player.country_name = country.name if country else country_code
                    except:
                        player.country_name = country_code


                # Show player profile for confirmation
                return render(request, 'analysis/chess_com_connect.html', {
                    'player_profile': player
                })
            else:
                messages.error(request, "Username not found on chess.com. Please check and try again.")
                return render(request, 'analysis/chess_com_connect.html', {'form_data': request.POST})

        except Exception as e:
            print(f"Error fetching chess.com profile: {e}")
            messages.error(request, "Error connecting to chess.com. Please try again later.")
            return render(request, 'analysis/chess_com_connect.html', {'form_data': request.POST})

    # GET request - show the connect form
    return render(request, 'analysis/chess_com_connect.html')


@login_required
def chess_com_save(request):
    """Save chess.com account to user profile"""
    if request.method == 'POST':
        username = request.POST.get('chess_com_username', '').strip()

        if username:
            profile, created = UserProfile.objects.get_or_create(user=request.user)
            profile.chess_com_username = username
            profile.save()

            messages.success(request, f"Successfully connected to chess.com account: {username}")
        else:
            messages.error(request, "Invalid username provided.")

    return redirect('analysis:home')


@login_required
def chess_com_disconnect(request):
    """Disconnect chess.com account"""
    profile, created = UserProfile.objects.get_or_create(user=request.user)
    profile.chess_com_username = None
    profile.save()

    messages.success(request, "Successfully disconnected from chess.com.")
    return redirect('analysis:home')


def parse_pgn_moves_and_clocks(pgn_text, initial_time=300, increment=0):
    """Extract moves and clock times from Chess.com PGN format"""
    import re

    if not pgn_text:
        return [], []

    try:
        # Find the moves section (after headers)
        moves_section = pgn_text.split('\n\n')[-1] if '\n\n' in pgn_text else pgn_text

        # Extract moves with clock times using regex
        # Pattern matches: 1. Nf3 {[%clk 0:04:59.8]} 1... e6 {[%clk 0:04:58.9]}
        # Updated to handle castling (O-O-O for queenside, O-O for kingside) and other special moves
        move_pattern = r'(O-O-O|O-O|[NBRQK]?[a-h]?[1-8]?x?[a-h][1-8](?:=[NBRQ])?[+#]?)\s*\{\[%clk\s+([0-9:\.]+)\]\}'
        matches = re.findall(move_pattern, moves_section)

        moves = []
        clocks = []

        # First, parse all the move clock times
        parsed_clocks = []
        for move, clock_str in matches:
            moves.append(move)

            # Convert Chess.com remaining time to centiseconds (like Lichess)
            # Chess.com formats: "0:04:59.8", "4:41:00", "1:25:20.9"
            # These represent REMAINING time on the clock
            try:
                time_parts = clock_str.split(':')
                total_seconds = 0

                if len(time_parts) == 2:
                    # Format: "59.8" or "04:59.8" (minutes:seconds.decimals)
                    minutes = int(time_parts[0])
                    seconds = float(time_parts[1])
                    total_seconds = minutes * 60 + seconds
                elif len(time_parts) == 3:
                    # Format: "4:41:00" (hours:minutes:seconds.decimals)
                    hours = int(time_parts[0])
                    minutes = int(time_parts[1])
                    seconds = float(time_parts[2])
                    total_seconds = hours * 3600 + minutes * 60 + seconds
                else:
                    # Fallback for unusual formats
                    total_seconds = 0

                # Convert remaining time to centiseconds (Lichess format expects remaining time in centiseconds)
                total_centiseconds = int(total_seconds * 100)
                parsed_clocks.append(total_centiseconds)

            except Exception as clock_error:
                parsed_clocks.append(0)

        # Now build the final clocks array in Lichess format
        # Lichess format: [starting_white, starting_black, after_move1, after_move2, ...]
        # Lichess adds 3 centiseconds to the initial time for starting times
        if parsed_clocks:
            starting_time_cs = (initial_time * 100) + 3  # Match Lichess format exactly
            clocks = [starting_time_cs, starting_time_cs] + parsed_clocks

        return moves, clocks

    except Exception as e:
        print(f"Error parsing PGN: {e}")
        return [], []


def parse_eco_from_pgn(pgn_text):
    """Extract ECO code from Chess.com PGN headers"""
    if not pgn_text:
        return "Unknown"

    try:
        import re
        # Look for ECO header in PGN: [ECO "C00"]
        eco_match = re.search(r'\[ECO "([A-E]\d{2})"\]', pgn_text)
        if eco_match:
            return eco_match.group(1)
    except:
        pass

    return "Unknown"


def extract_opening_name_from_eco_url(eco_url):
    """Extract opening name from Chess.com ECO URL"""
    if not eco_url or not isinstance(eco_url, str):
        return "Unknown Opening"

    try:
        # Extract from URL like "https://www.chess.com/openings/Italian-Game-Traxler-Knight-Sacrifice-Line"
        if '/openings/' in eco_url:
            name_part = eco_url.split('/openings/')[-1]
            # Convert URL format to readable name
            name = name_part.replace('-', ' ').replace('_', ' ')
            return name
        return "Unknown Opening"
    except:
        return "Unknown Opening"


def parse_chess_com_time_control(time_control_str):
    """Parse Chess.com time control formats into initial/increment seconds"""
    if not time_control_str:
        return 300, 0  # Default 5 minutes, no increment

    try:
        time_control = str(time_control_str).strip()

        # Handle different Chess.com time control formats:

        # Format: "180+2" (3 minutes + 2 second increment)
        if '+' in time_control:
            parts = time_control.split('+')
            initial = int(parts[0])
            increment = int(parts[1]) if len(parts) > 1 else 0
            return initial, increment

        # Format: "1/259200" (correspondence - 1 move per 259200 seconds)
        elif '/' in time_control:
            # This is correspondence chess - extract the time per move
            parts = time_control.split('/')
            if len(parts) == 2:
                try:
                    moves = int(parts[0])
                    seconds_per_move = int(parts[1])
                    # For correspondence, set initial time to time per move
                    return seconds_per_move, 0  # No increment in correspondence
                except ValueError:
                    pass
            # Fallback: set to 3 days (standard correspondence time)
            return 259200, 0  # 3 days per move

        # Format: "300" (just initial time, no increment)
        else:
            initial = int(time_control)
            return initial, 0

    except (ValueError, IndexError):
        # If parsing fails, return default
        return 300, 0


def extract_ending_type_from_pgn(pgn_text, white_result, black_result):
    """Extract the ending type from Chess.com PGN text

    Returns one of: 'stalemate', 'agreement', 'repetition', '50moveRule', 'insufficientMaterial', or None
    """
    if not pgn_text:
        return None

    # Look for Termination tag in PGN headers
    termination_match = None
    for line in pgn_text.split('\n'):
        if line.startswith('[Termination'):
            termination_match = line
            break

    if not termination_match:
        return None

    termination_lower = termination_match.lower()

    # Check for stalemate
    if 'stalemate' in termination_lower:
        return 'stalemate'

    # Check for agreement
    if 'agreement' in termination_lower:
        return 'agreement'

    # Check for 50-move rule
    if '50' in termination_lower and 'move' in termination_lower:
        return '50moveRule'

    # Check for repetition
    if 'repetition' in termination_lower:
        return 'repetition'

    # Check for insufficient material
    if 'insufficient' in termination_lower and 'material' in termination_lower:
        return 'insufficientMaterial'

    return None


def convert_chess_com_to_universal_format(chess_com_game):
    """Convert Chess.com game data to universal format with enriched opening data"""
    try:
        # Parse time control first
        initial_time, increment = parse_chess_com_time_control(chess_com_game.get('time_control', '300'))

        # Extract moves and clocks from PGN with time control info
        moves_list, clocks_list = parse_pgn_moves_and_clocks(
            chess_com_game.get('pgn', ''),
            initial_time,
            increment
        )

        # Convert moves list to single string
        moves_string = ' '.join(moves_list)

        # Classify opening using backward move matching
        opening_classification = classify_opening_by_moves(moves_string)

        # Handle correspondence games differently
        if clocks_list and initial_time >= 86400:  # 24 hours or more (correspondence)
            # For correspondence games, Chess.com clocks don't represent real time pressure
            # Generate reasonable clock values that start with full time
            starting_time_cs = (initial_time + increment) * 100
            adjusted_clocks = []
            for i in range(len(clocks_list)):
                # Both players start with full time, then slight decreases
                time_remaining = starting_time_cs - (i * 100)  # Small decrease per move
                adjusted_clocks.append(max(time_remaining, starting_time_cs * 0.95))
            clocks_list = adjusted_clocks

        # Determine winner
        white_result = chess_com_game.get('white', {}).get('result', '')
        black_result = chess_com_game.get('black', {}).get('result', '')

        winner = None
        if white_result == 'win':
            winner = 'white'
        elif black_result == 'win':
            winner = 'black'

        # Extract ending type from PGN (for draws)
        ending_type = None
        if winner is None:  # Only for draws
            ending_type = extract_ending_type_from_pgn(
                chess_com_game.get('pgn', ''),
                white_result,
                black_result
            )

        # Create Lichess-compatible format
        lichess_format = {
            # Lichess-compatible fields
            "id": chess_com_game.get('uuid', ''),
            "rated": chess_com_game.get('rated', True),
            "variant": "standard",
            "speed": chess_com_game.get('time_class', 'blitz'),  # chess.com: blitz, bullet, rapid
            "perf": chess_com_game.get('time_class', 'blitz'),
            "createdAt": int(chess_com_game.get('end_time', 0)) * 1000,  # Convert to milliseconds
            "lastMoveAt": int(chess_com_game.get('end_time', 0)) * 1000,  # Use end_time as approximation
            "status": ("mate" if "checkmate" in chess_com_game.get('white', {}).get('result', '') or
                              "checkmate" in chess_com_game.get('black', {}).get('result', '') else
                       "outoftime" if "timeout" in chess_com_game.get('white', {}).get('result', '') or
                                      "timeout" in chess_com_game.get('black', {}).get('result', '') else
                       "resign"),
            "source": "pool",  # Default for Chess.com
            "players": {
                "white": {
                    "user": {
                        "name": chess_com_game.get('white', {}).get('username', ''),
                        "id": chess_com_game.get('white', {}).get('username', '').lower()
                    },
                    "rating": chess_com_game.get('white', {}).get('rating', 0),
                    "ratingDiff": 0  # Chess.com doesn't provide this easily
                },
                "black": {
                    "user": {
                        "name": chess_com_game.get('black', {}).get('username', ''),
                        "id": chess_com_game.get('black', {}).get('username', '').lower()
                    },
                    "rating": chess_com_game.get('black', {}).get('rating', 0),
                    "ratingDiff": 0  # Chess.com doesn't provide this easily
                }
            },
            "winner": winner,
            "endingType": ending_type,  # For draws: stalemate, agreement, repetition, 50moveRule, insufficientMaterial
            "opening": {
                "eco": opening_classification['eco'],
                "name": opening_classification['name'],
                "ply": opening_classification['ply'],
                "fen": opening_classification['fen'],
                "moves": opening_classification['moves']
            },
            "moves": moves_string,
            "clocks": clocks_list,
            "clock": {
                "initial": initial_time,
                "increment": increment,
                "totalTime": initial_time + increment  # Approximate total time
            }
        }

        return lichess_format

    except Exception as e:
        print(f"Error converting Chess.com game to universal format: {e}")
        # Return minimal format to prevent crashes
        return {
            "id": chess_com_game.get('uuid', 'unknown'),
            "error": f"Conversion failed: {str(e)}",
            "chess_com_data": chess_com_game
        }


def check_draw_by_agreement(pgn_text):
    """Check if a draw was by mutual agreement

    Args:
        pgn_text: PGN text from Lichess with literate=true

    Returns:
        True if draw by agreement, False otherwise
    """
    if not pgn_text:
        return False

    # Look for "offers draw" in the PGN comments right before the game ends
    lines = pgn_text.split('\n')

    for i, line in enumerate(lines):
        if 'offers draw' in line.lower():
            # Get remaining text after the offer
            remaining_lines = lines[i:]
            remaining_text = '\n'.join(remaining_lines).lower()

            # Check if 1/2-1/2 appears after the offer
            if '1/2-1/2' not in remaining_text:
                continue

            # Extract text between the offer and the result
            result_idx = remaining_text.find('1/2-1/2')
            text_between = remaining_text[:result_idx]

            # Check if there are any move numbers (indicating moves after the offer)
            # Move numbers look like "15. " or "15..."
            has_moves_after = False
            for j in range(len(text_between) - 2):
                if text_between[j].isdigit() and text_between[j+1:j+3] in ['. ', '..']:
                    has_moves_after = True
                    break

            if not has_moves_after:
                return True

    return False


def check_threefold_repetition(moves_str):
    """Check if the game ended in threefold repetition

    Threefold repetition occurs when the exact same board position
    (same player to move, castling rights, and en passant) occurs 3 times.

    Args:
        moves_str: Space-separated string of moves in SAN format

    Returns:
        True if threefold repetition detected, False otherwise
    """
    if not moves_str:
        return False

    try:
        import chess

        # Create a new board
        board = chess.Board()

        # Parse and play all moves
        moves_list = moves_str.split()
        for move_san in moves_list:
            try:
                # Parse the move in Standard Algebraic Notation
                move = board.parse_san(move_san)
                board.push(move)
            except (chess.InvalidMoveError, chess.IllegalMoveError, chess.AmbiguousMoveError):
                # If we can't parse a move, return False
                return False

        # Check if the final position is a threefold repetition
        # Use is_repetition(3) to check if the current position occurred 3+ times
        return board.is_repetition(3)

    except Exception as e:
        print(f"Error checking threefold repetition: {e}")
        return False


def check_50_move_rule(moves_str):
    """Check if the game ended by the 50-move rule

    The 50-move rule states that a draw can be claimed if 50 consecutive moves
    (100 plies) have been made without a pawn move or capture.

    Args:
        moves_str: Space-separated string of moves in SAN format

    Returns:
        True if 50-move rule detected, False otherwise
    """
    if not moves_str:
        return False

    try:
        import chess

        # Create a new board
        board = chess.Board()

        # Parse and play all moves
        moves_list = moves_str.split()
        for move_san in moves_list:
            try:
                # Parse the move in Standard Algebraic Notation
                move = board.parse_san(move_san)
                board.push(move)
            except (chess.InvalidMoveError, chess.IllegalMoveError, chess.AmbiguousMoveError):
                # If we can't parse a move, return False
                return False

        # Check if the fifty-move rule applies
        # is_fifty_moves() checks if halfmove clock >= 100
        return board.is_fifty_moves()

    except Exception as e:
        print(f"Error checking 50-move rule: {e}")
        return False


def check_insufficient_material(moves_str):
    """Check if the game ended due to insufficient material

    Insufficient material occurs when neither player has enough pieces to checkmate.
    Examples:
    - King vs King
    - King and Bishop vs King
    - King and Knight vs King
    - King and Bishop vs King and Bishop (with bishops on same color)

    Args:
        moves_str: Space-separated string of moves in SAN format

    Returns:
        True if insufficient material detected, False otherwise
    """
    if not moves_str:
        return False

    try:
        import chess

        # Create a new board
        board = chess.Board()

        # Parse and play all moves
        moves_list = moves_str.split()
        for move_san in moves_list:
            try:
                # Parse the move in Standard Algebraic Notation
                move = board.parse_san(move_san)
                board.push(move)
            except (chess.InvalidMoveError, chess.IllegalMoveError, chess.AmbiguousMoveError):
                # If we can't parse a move, return False
                return False

        # Check if there is insufficient material to checkmate
        return board.is_insufficient_material()

    except Exception as e:
        print(f"Error checking insufficient material: {e}")
        return False


def extract_ending_type_from_lichess(lichess_game):
    """Extract the ending type from Lichess game data

    Args:
        lichess_game: Dict with Lichess game data (with pgnInJson=true and literate=true)

    Returns:
        One of: 'stalemate', 'agreement', 'repetition', '50moveRule', 'insufficientMaterial', or None
    """
    # Only process draws
    if lichess_game.get('winner') is not None:
        return None

    status = lichess_game.get('status', '').lower()

    # Stalemate is explicitly marked
    if status == 'stalemate':
        return 'stalemate'

    # For status == 'draw', determine the specific type
    if status == 'draw':
        pgn_text = lichess_game.get('pgn', '')
        moves_str = lichess_game.get('moves', '')

        # Check for draw by agreement first
        if check_draw_by_agreement(pgn_text):
            return 'agreement'

        # Check for threefold repetition
        if check_threefold_repetition(moves_str):
            return 'repetition'

        # Check for 50-move rule
        if check_50_move_rule(moves_str):
            return '50moveRule'

        # Check for insufficient material
        if check_insufficient_material(moves_str):
            return 'insufficientMaterial'

        # If we can't determine the type, return None
        return None

    return None


def convert_lichess_to_universal_format(lichess_game):
    """
    Convert Lichess game data to universal format by enriching opening data with FEN and moves

    Args:
        lichess_game: Dict with Lichess game data (already has opening.eco, opening.name, opening.ply)

    Returns:
        Dict with enriched opening data including fen and moves
    """
    try:
        # Make a copy to avoid modifying the original
        enriched_game = lichess_game.copy()

        # Extract ending type for draws if not already present
        if 'endingType' not in enriched_game or enriched_game.get('endingType') is None:
            ending_type = extract_ending_type_from_lichess(lichess_game)
            if ending_type:
                enriched_game['endingType'] = ending_type

        # Check if game has opening data
        if 'opening' in enriched_game and enriched_game['opening']:
            opening = enriched_game['opening']
            eco = opening.get('eco', 'Unknown')
            name = opening.get('name', 'Unknown')
            ply = opening.get('ply', 0)

            # Look up the opening in the database to get FEN and moves
            opening_details = lookup_opening_in_database(eco, name, ply)

            # Add FEN and moves to the opening data
            enriched_game['opening']['fen'] = opening_details.get('fen', '')
            enriched_game['opening']['moves'] = opening_details.get('moves', '')
        else:
            # No opening data, add empty opening structure
            enriched_game['opening'] = {
                'eco': 'Unknown',
                'name': 'Unknown',
                'ply': 0,
                'fen': '',
                'moves': ''
            }

        return enriched_game

    except Exception as e:
        print(f"Error enriching Lichess game data: {e}")
        # Return the original game if enrichment fails
        return lichess_game


def convert_chess_com_game_to_dict(game):
    """Convert Chess.com game object to dictionary format"""
    white_data = getattr(game, 'white', None) or {}
    black_data = getattr(game, 'black', None) or {}

    game_data = {
        'url': getattr(game, 'url', ''),
        'pgn': getattr(game, 'pgn', ''),
        'time_control': str(getattr(game, 'time_control', '')),
        'end_time': getattr(game, 'end_time', 0),
        'rated': getattr(game, 'rated', True),
        'uuid': getattr(game, 'uuid', ''),
        'initial_setup': getattr(game, 'initial_setup', ''),
        'fen': getattr(game, 'fen', ''),
        'time_class': getattr(game, 'time_class', ''),
        'rules': getattr(game, 'rules', 'chess'),
        'white': {
            'rating': getattr(white_data, 'rating', 0),
            'result': getattr(white_data, 'result', ''),
            'username': getattr(white_data, 'username', ''),
            'uuid': getattr(white_data, 'uuid', '')
        },
        'black': {
            'rating': getattr(black_data, 'rating', 0),
            'result': getattr(black_data, 'result', ''),
            'username': getattr(black_data, 'username', ''),
            'uuid': getattr(black_data, 'uuid', '')
        },
        'eco': getattr(game, 'eco', '')
    }

    # Add accuracies if available
    accuracies = getattr(game, 'accuracies', None)
    if accuracies:
        game_data['accuracies'] = {
            'white': getattr(accuracies, 'white', 0),
            'black': getattr(accuracies, 'black', 0)
        }

    return game_data


@login_required
def fetch_chess_com_games(request, username):
    """AJAX endpoint to dispatch Celery task for fetching Chess.com games"""
    # Verify this is the user's chess.com account
    profile = get_object_or_404(UserProfile, user=request.user, chess_com_username=username)

    try:
        # Get max_games from request (default to analysis setting)
        max_games = int(request.GET.get('max_games', ANALYSIS_GAME_COUNT))

        # Validate max_games to prevent abuse
        if max_games < 1 or max_games > 1000:
            max_games = ANALYSIS_GAME_COUNT

        # Get the 'since' parameter (timestamp of newest game in last dataset)
        # Frontend sends milliseconds, but Chess.com uses seconds
        since_timestamp = request.GET.get('since', None)
        if since_timestamp:
            since_timestamp = int(since_timestamp) // 1000  # Convert ms to seconds

        # Import the task
        from .tasks import fetch_chess_com_games_task

        # Dispatch Celery task to fetch games in background
        task = fetch_chess_com_games_task.apply_async(
            args=[request.user.id, username, max_games, since_timestamp],
            queue='chess_com_api'
        )

        # Return task ID so frontend can poll for status
        return JsonResponse({
            'success': True,
            'task_id': task.id,
            'status': 'started',
            'message': 'Game fetch started in background. Please wait...'
        })

    except Exception as e:
        print(f"Error dispatching Chess.com games fetch task: {e}")
        return JsonResponse({
            'success': False,
            'error': str(e)
        })


@login_required
def check_task_status(request, task_id):
    """
    Poll endpoint to check the status of a Celery task (works for both Chess.com and Lichess)
    Returns task state and result/progress information
    """
    from celery.result import AsyncResult

    try:
        task = AsyncResult(task_id)

        if task.state == 'PENDING':
            response = {
                'state': task.state,
                'status': 'Task is waiting to start...'
            }
        elif task.state == 'PROGRESS':
            response = {
                'state': task.state,
                'current': task.info.get('current', 0),
                'total': task.info.get('total', 100),
                'status': task.info.get('status', ''),
                'games_found': task.info.get('games_found', 0)
            }
        elif task.state == 'SUCCESS':
            # Task completed successfully
            result = task.result
            response = {
                'state': task.state,
                'result': result
            }
        elif task.state == 'FAILURE':
            # Task failed
            response = {
                'state': task.state,
                'status': str(task.info),
                'error': 'Task failed. Please try again.'
            }
        else:
            # Unknown state
            response = {
                'state': task.state,
                'status': str(task.info)
            }

        return JsonResponse(response)

    except Exception as e:
        return JsonResponse({
            'state': 'ERROR',
            'error': str(e)
        }, status=500)


@login_required
def generate_chess_com_analysis_report(request, username, dataset_id):
    """Generate Chess.com analysis report using unified template (DEPRECATED - use generate_analysis_report)"""
    return _generate_unified_analysis_report(request, username, dataset_id)


@login_required
def account_settings(request):
    """Account settings page for logged-in users"""
    user = request.user
    profile, created = UserProfile.objects.get_or_create(user=user)

    if request.method == 'POST':
        action = request.POST.get('action')

        if action == 'update_profile':
            # Update user information
            new_email = request.POST.get('email', '').strip()
            new_first_name = request.POST.get('first_name', '').strip()
            new_last_name = request.POST.get('last_name', '').strip()

            if new_email and new_email != user.email:
                # Check if email is already taken
                if User.objects.filter(email=new_email).exclude(id=user.id).exists():
                    messages.error(request, "This email is already taken by another user.")
                else:
                    user.email = new_email
                    messages.success(request, "Email updated successfully.")

            user.first_name = new_first_name
            user.last_name = new_last_name
            user.save()

            if action == 'update_profile' and not messages.get_messages(request):
                messages.success(request, "Profile updated successfully.")

        elif action == 'change_password':
            # Handle password change
            password_form = CustomPasswordChangeForm(user, request.POST)
            if password_form.is_valid():
                password_form.save()
                update_session_auth_hash(request, password_form.user)  # Keep user logged in
                messages.success(request, "Password changed successfully.")
            else:
                for field, errors in password_form.errors.items():
                    for error in errors:
                        messages.error(request, f"{field}: {error}")

        elif action == 'unlink_lichess':
            # Unlink Lichess account
            profile.lichess_username = None
            profile.lichess_access_token = None
            profile.save()
            messages.success(request, "Lichess account unlinked successfully.")

        elif action == 'unlink_chess_com':
            # Unlink Chess.com account
            profile.chess_com_username = None
            profile.save()
            messages.success(request, "Chess.com account unlinked successfully.")

        elif action == 'update_board_theme':
            # Update board theme preference
            board_theme = request.POST.get('board_theme', 'blue')
            if board_theme in ['blue', 'green', 'brown']:
                profile.board_theme = board_theme
                profile.save()
                messages.success(request, f"Board theme updated to {board_theme}.")
            else:
                messages.error(request, "Invalid board theme selected.")

        elif action == 'update_theme':
            # Update theme preference
            theme = request.POST.get('theme', 'system')
            # Theme is handled by JavaScript/localStorage, but we can store server-side preference too
            messages.success(request, f"Theme preference updated to {theme}.")

        return redirect('analysis:settings')

    # GET request - show the settings page
    password_form = CustomPasswordChangeForm(user)

    context = {
        'user': user,
        'profile': profile,
        'password_form': password_form,
    }

    return render(request, 'analysis/settings.html', context)


def get_daily_puzzle_data():
    """
    Fetch daily puzzle from Chess.com with caching
    Cache expires at 12:05 AM EST to align with Chess.com's daily puzzle release
    Returns dict with puzzle data or None if failed

    This function uses a Celery task to fetch the puzzle, which ensures
    we don't hit Chess.com's rate limits by coordinating with other API calls.
    """
    from django.utils import timezone
    import pytz
    from datetime import datetime, timedelta
    from .tasks import fetch_daily_puzzle_task

    # Create cache key that includes the date to ensure daily refresh
    est = pytz.timezone('US/Eastern')
    now_est = timezone.now().astimezone(est)
    current_date = now_est.strftime('%Y-%m-%d')
    cache_key = f'daily_puzzle_{current_date}'

    puzzle_data = cache.get(cache_key)

    if puzzle_data:
        return puzzle_data

    try:
        # Use Celery task to fetch puzzle with proper rate limiting
        # Use apply_async with queue specified for Chess.com API coordination
        result = fetch_daily_puzzle_task.apply_async(
            queue='chess_com_api'
        )

        # Wait up to 30 seconds for the task to complete
        puzzle_data = result.get(timeout=30)

        if puzzle_data:
            # Cache until next 12:05 AM EST (when new puzzle is released)
            cache_timeout = get_seconds_until_next_puzzle_release()
            cache.set(cache_key, puzzle_data, cache_timeout)
            return puzzle_data

    except Exception as e:
        print(f"Error fetching daily puzzle via Celery task: {e}")

    # Return fallback puzzle if API fails
    return get_fallback_puzzle()


def get_lichess_puzzle_data():
    """
    Fetch daily puzzle from Lichess with caching
    Returns dict with puzzle data or None if failed
    """
    from django.utils import timezone
    import pytz

    # Create cache key that includes the date
    est = pytz.timezone('US/Eastern')
    now_est = timezone.now().astimezone(est)
    current_date = now_est.strftime('%Y-%m-%d')
    cache_key = f'lichess_puzzle_{current_date}'

    puzzle_data = cache.get(cache_key)

    if puzzle_data:
        return puzzle_data

    try:
        # Fetch daily puzzle from Lichess API
        response = requests.get('https://lichess.org/api/puzzle/daily', timeout=10)
        response.raise_for_status()

        lichess_data = response.json()

        if lichess_data and 'puzzle' in lichess_data and 'game' in lichess_data:
            puzzle = lichess_data['puzzle']
            game = lichess_data['game']

            # Extract solution moves from UCI format to algebraic notation
            solution_moves = convert_uci_to_algebraic(puzzle['solution'], game['pgn'], puzzle['initialPly'])

            # Calculate FEN position at the puzzle start
            puzzle_fen = get_position_fen_from_pgn(game['pgn'], puzzle['initialPly'])

            # Get the last move that led to the puzzle position
            # Disabled: Don't show last move highlighting for cleaner puzzle presentation
            # last_move = get_last_move_from_pgn(game['pgn'], puzzle['initialPly'])

            puzzle_data = {
                'id': puzzle['id'],
                'title': f"Lichess Daily Puzzle - Rating {puzzle['rating']}",
                'fen': puzzle_fen,
                'solution': solution_moves,
                'url': f"https://lichess.org/training/{puzzle['id']}",
                'rating': puzzle['rating'],
                'plays': puzzle['plays'],
                'themes': puzzle['themes'],
                'source': 'lichess',
                'lastMove': None  # Don't highlight last move
            }

            # Cache until next puzzle (same logic as Chess.com)
            cache_timeout = get_seconds_until_next_puzzle_release()
            cache.set(cache_key, puzzle_data, cache_timeout)

            return puzzle_data

    except Exception as e:
        print(f"Error fetching Lichess puzzle: {e}")

    # Return fallback puzzle if API fails
    return get_lichess_fallback_puzzle()


def convert_uci_to_algebraic(uci_moves, pgn, initial_ply):
    """
    Convert UCI moves to algebraic notation using the game position
    """
    try:
        import chess
        import chess.pgn
        from io import StringIO

        # Parse the PGN to get the position at initialPly
        pgn_io = StringIO(pgn)
        game = chess.pgn.read_game(pgn_io)

        if not game:
            return []

        board = game.board()
        moves = list(game.mainline_moves())

        # Lichess initialPly is the ply AFTER which the puzzle starts
        # So we need to play up to AND INCLUDING the initialPly move
        plies_to_play = min(initial_ply + 1, len(moves))

        for i in range(plies_to_play):
            board.push(moves[i])

        # Convert UCI moves to algebraic
        algebraic_moves = []
        for uci_move in uci_moves:
            try:
                # Clean the UCI move (remove spaces)
                uci_move = uci_move.replace(' ', '')

                move = chess.Move.from_uci(uci_move)
                if move in board.legal_moves:
                    algebraic = board.san(move)
                    algebraic_moves.append(algebraic)
                    board.push(move)
                else:
                    break
            except Exception as e:
                break

        return algebraic_moves

    except Exception as e:
        print(f"Error converting UCI to algebraic: {e}")
        return []


def get_last_move_from_pgn(pgn, initial_ply):
    """
    Get the last move that was played before the puzzle position
    Returns dict with 'from' and 'to' squares, or None if not available
    """
    try:
        import chess
        import chess.pgn
        from io import StringIO

        pgn_io = StringIO(pgn)
        game = chess.pgn.read_game(pgn_io)

        if not game:
            return None

        board = game.board()
        moves = list(game.mainline_moves())

        # We need the move at position initial_ply (0-indexed)
        # This is the last move before the puzzle starts
        if initial_ply >= len(moves):
            return None

        # Play moves up to but not including initial_ply
        for i in range(initial_ply):
            board.push(moves[i])

        # Get the move at initial_ply
        last_move = moves[initial_ply]

        return {
            'from': chess.square_name(last_move.from_square),
            'to': chess.square_name(last_move.to_square)
        }

    except Exception as e:
        print(f"Error getting last move from PGN: {e}")
        return None


def get_position_fen_from_pgn(pgn, initial_ply):
    """
    Get FEN position from PGN at a specific ply

    Note: Lichess puzzles use initialPly to indicate after which move the puzzle starts.
    The puzzle position is AFTER the move at initialPly is played.
    """
    try:
        import chess
        import chess.pgn
        from io import StringIO

        pgn_io = StringIO(pgn)
        game = chess.pgn.read_game(pgn_io)

        if not game:
            return chess.STARTING_FEN

        board = game.board()
        moves = list(game.mainline_moves())

        # Lichess initialPly is the ply AFTER which the puzzle starts
        # So we need to play up to AND INCLUDING the initialPly move
        # This means we play moves 0 through initial_ply (inclusive)
        plies_to_play = min(initial_ply + 1, len(moves))

        for i in range(plies_to_play):
            move = moves[i]
            board.push(move)

        return board.fen()

    except Exception as e:
        print(f"Error getting FEN from PGN: {e}")
        return chess.STARTING_FEN


def get_lichess_fallback_puzzle():
    """
    Return a fallback Lichess puzzle when API fails
    """
    return {
        'id': 'fallback',
        'title': 'Lichess Puzzle (Fallback)',
        'fen': 'r1bqkb1r/pppp1ppp/2n2n2/1B2p3/4P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4',
        'solution': ['Bxf7+', 'Kxf7', 'Ng5+'],
        'url': 'https://lichess.org/training',
        'rating': 1500,
        'plays': 0,
        'themes': ['tactics'],
        'source': 'lichess',
        'fallback': True
    }


def get_seconds_until_next_puzzle_release():
    """
    Calculate seconds until next 12:05 AM EST (when Chess.com releases new daily puzzle)
    Returns number of seconds to cache the puzzle
    """
    from django.utils import timezone
    import pytz
    from datetime import datetime, timedelta

    est = pytz.timezone('US/Eastern')
    now_est = timezone.now().astimezone(est)

    # Find next 12:05 AM EST
    next_release = now_est.replace(hour=0, minute=5, second=0, microsecond=0)

    # If it's already past 12:05 AM today, move to tomorrow
    if now_est >= next_release:
        next_release += timedelta(days=1)

    # Calculate seconds until next release
    delta = next_release - now_est
    seconds_until_release = int(delta.total_seconds())

    # Add 5 minute buffer to avoid race conditions
    return seconds_until_release + 300  # 5 minutes buffer


def get_last_move_from_chess_com_pgn(pgn, target_fen):
    """
    Get the last move from Chess.com PGN that led to the puzzle position
    Returns dict with 'from' and 'to' squares, or None if not available

    Note: Chess.com puzzles only provide the starting FEN and solution moves.
    They do NOT provide the game history before the puzzle, so there is no
    "last move" to highlight. This function returns None for Chess.com puzzles.
    """
    # Chess.com API doesn't provide the move that led to the puzzle position
    # The puzzle just starts from the given FEN with no prior move history
    return None


def extract_solution_from_pgn(pgn):
    """
    Extract solution moves from PGN string
    Returns list of moves in algebraic notation
    """
    if not pgn:
        return []

    try:
        # Remove headers and comments from PGN
        # PGN format: "1. Move1 Move2 2. Move3 Move4 ..."
        import re

        # Remove everything in brackets and headers
        clean_pgn = re.sub(r'\[.*?\]', '', pgn)
        clean_pgn = re.sub(r'\{.*?\}', '', clean_pgn)

        # Extract just the moves
        moves = []

        # Split by move numbers and extract moves
        parts = re.split(r'\d+\.', clean_pgn)

        for part in parts:
            if part.strip():
                # Split moves in this part
                move_part = part.strip().split()
                for move in move_part:
                    move = move.strip()
                    # Filter out placeholders, result indicators, and empty moves
                    if move and not move.startswith('(') and not move.endswith(')'):
                        # Remove result indicators, placeholders, and ellipsis
                        if move not in ['1-0', '0-1', '1/2-1/2', '*', '..', '...']:
                            moves.append(move)

        return moves[:10]  # Limit to reasonable number of moves

    except Exception as e:
        print(f"Error parsing PGN: {e}")
        return []


def get_fallback_puzzle():
    """
    Return a fallback puzzle when API fails
    This is a classic back rank mate pattern
    """
    return {
        'title': 'Chess.com Puzzle (Fallback)',
        'fen': 'r5k1/pp3ppp/2p5/8/8/5Q2/PPP2qPP/R3R1K1 w - - 0 1',
        'pgn': '1. Qf8+ Rxf8 2. Re8#',
        'url': 'https://chess.com/puzzles',
        'image': None,
        'solution': ['Qf8+', 'Rxf8', 'Re8#'],
        'publish_time': None,
        'publish_datetime': None,
        'source': 'chess.com',
        'fallback': True,
        'lastMove': None
    }


def daily_puzzle_api(request):
    """
    API endpoint to fetch daily puzzle data from both Chess.com and Lichess
    Returns JSON with both puzzle sources
    """
    # Get requested source (default to both)
    source = request.GET.get('source', 'both')

    result = {'success': True, 'puzzles': {}}

    if source in ['both', 'chess.com']:
        chess_puzzle = get_daily_puzzle_data()
        if chess_puzzle:
            result['puzzles']['chess.com'] = chess_puzzle

    if source in ['both', 'lichess']:
        lichess_puzzle = get_lichess_puzzle_data()
        if lichess_puzzle:
            result['puzzles']['lichess'] = lichess_puzzle

    if result['puzzles']:
        # Set default puzzle (Chess.com if available, otherwise Lichess)
        if 'chess.com' in result['puzzles']:
            result['defaultPuzzle'] = result['puzzles']['chess.com']
        elif 'lichess' in result['puzzles']:
            result['defaultPuzzle'] = result['puzzles']['lichess']

        return JsonResponse(result)
    else:
        return JsonResponse({
            'success': False,
            'error': 'Failed to load daily puzzles from both sources'
        }, status=500)


@login_required
def get_solved_blunders(request, report_id):
    """
    API endpoint to get all solved blunders for a specific report
    Returns JSON with list of blunder keys that have been solved
    """
    try:
        # Verify report belongs to user
        report = get_object_or_404(AnalysisReport, id=report_id, user=request.user)

        # Get all solved blunders for this report
        solved_blunders = SolvedBlunder.objects.filter(
            user=request.user,
            report=report
        ).values_list('blunder_key', flat=True)

        return JsonResponse({
            'success': True,
            'solved_blunders': list(solved_blunders)
        })
    except Exception as e:
        return JsonResponse({
            'success': False,
            'error': str(e)
        }, status=500)


@login_required
def mark_blunder_solved(request, report_id):
    """
    API endpoint to mark a blunder as solved
    Expects POST request with blunder_key in the body
    """
    if request.method != 'POST':
        return JsonResponse({
            'success': False,
            'error': 'POST request required'
        }, status=405)

    try:
        # Verify report belongs to user
        report = get_object_or_404(AnalysisReport, id=report_id, user=request.user)

        # Parse request body
        data = json.loads(request.body)
        blunder_key = data.get('blunder_key')

        if not blunder_key:
            return JsonResponse({
                'success': False,
                'error': 'blunder_key is required'
            }, status=400)

        # Create or get the solved blunder record
        solved_blunder, created = SolvedBlunder.objects.get_or_create(
            user=request.user,
            report=report,
            blunder_key=blunder_key
        )

        return JsonResponse({
            'success': True,
            'created': created,
            'solved_at': solved_blunder.solved_at.isoformat()
        })
    except Exception as e:
        return JsonResponse({
            'success': False,
            'error': str(e)
        }, status=500)


@login_required
def get_solved_puzzles(request, report_id):
    """
    API endpoint to get all solved puzzles for a specific report
    Returns JSON with list of puzzle IDs that have been solved
    """
    try:
        # Verify report belongs to user
        report = get_object_or_404(AnalysisReport, id=report_id, user=request.user)

        # Get all solved puzzles for this report
        solved_puzzles = SolvedPuzzle.objects.filter(
            user=request.user,
            report=report
        ).values_list('puzzle_id', flat=True)

        return JsonResponse({
            'success': True,
            'solved_puzzles': list(solved_puzzles)
        })
    except Exception as e:
        return JsonResponse({
            'success': False,
            'error': str(e)
        }, status=500)


@login_required
def mark_puzzle_solved(request, report_id):
    """
    API endpoint to mark a custom puzzle as solved
    Expects POST request with puzzle_id in the body
    """
    if request.method != 'POST':
        return JsonResponse({
            'success': False,
            'error': 'POST request required'
        }, status=405)

    try:
        # Verify report belongs to user
        report = get_object_or_404(AnalysisReport, id=report_id, user=request.user)

        # Parse request body
        data = json.loads(request.body)
        puzzle_id = data.get('puzzle_id')

        if not puzzle_id:
            return JsonResponse({
                'success': False,
                'error': 'puzzle_id is required'
            }, status=400)

        # Create or get the solved puzzle record
        solved_puzzle, created = SolvedPuzzle.objects.get_or_create(
            user=request.user,
            report=report,
            puzzle_id=puzzle_id
        )

        return JsonResponse({
            'success': True,
            'created': created,
            'solved_at': solved_puzzle.solved_at.isoformat()
        })
    except Exception as e:
        return JsonResponse({
            'success': False,
            'error': str(e)
        }, status=500)


@login_required
def store_elo_chart_data(request, dataset_id):
    """Store pre-computed ELO chart data from the frontend"""
    if request.method != 'POST':
        return JsonResponse({'success': False, 'error': 'POST required'}, status=405)

    try:
        # Get the dataset and verify ownership
        game_dataset = get_object_or_404(GameDataSet, id=dataset_id, user=request.user)

        # Parse the ELO chart data from request body
        data = json.loads(request.body)
        elo_chart_data = data.get('elo_chart_data', [])

        # Store it in the dataset
        game_dataset.elo_chart_data = elo_chart_data
        game_dataset.save()

        return JsonResponse({
            'success': True,
            'message': 'ELO chart data stored successfully'
        })
    except Exception as e:
        return JsonResponse({
            'success': False,
            'error': str(e)
        }, status=500)


@login_required
def generate_llm_insights(request, report_id):
    """
    Generate LLM insights for a specific report component

    POST body should contain:
    - component: The component to generate insights for (e.g., 'game_results')
    - force_regenerate: Optional boolean to regenerate even if insights exist
    """
    if request.method != 'POST':
        return JsonResponse({'success': False, 'error': 'POST required'}, status=405)

    try:
        # Get the report and verify ownership
        report = get_object_or_404(AnalysisReport, id=report_id, user=request.user)

        # Parse request body
        data = json.loads(request.body)
        component = data.get('component', 'game_results')
        force_regenerate = data.get('force_regenerate', False)

        # Check if insights already exist
        if not force_regenerate and report.llm_insights and component in report.llm_insights:
            cached_data = report.llm_insights[component]
            # Extract the insights text from the cached data structure
            insights_text = cached_data.get('insights') if isinstance(cached_data, dict) else cached_data
            return JsonResponse({
                'success': True,
                'insights': insights_text,
                'cached': True
            })

        # Determine platform and username
        if report.game_dataset.lichess_username:
            username = report.game_dataset.lichess_username
            platform = 'lichess'
        elif report.game_dataset.chess_com_username:
            username = report.game_dataset.chess_com_username
            platform = 'chess.com'
        else:
            return JsonResponse({
                'success': False,
                'error': 'Unable to determine platform for report'
            }, status=400)

        # Load ELO averages data
        elo_by_time_control = get_latest_elo_by_time_control(
            report.game_dataset.raw_data,
            username,
            platform
        )
        elo_averages_data = None
        if elo_by_time_control:
            elo_averages_data = load_elo_averages_for_time_controls(elo_by_time_control)

        # Import the insights generator
        from .llm_insights import InsightsGenerator, DeepSeekClient

        # Get DeepSeek API key from settings
        deepseek_api_key = getattr(settings, 'DEEPSEEK_API_KEY', None)
        if not deepseek_api_key:
            return JsonResponse({
                'success': False,
                'error': 'DeepSeek API key not configured. Please add DEEPSEEK_API_KEY to settings.'
            }, status=500)

        # Initialize the LLM client
        llm_client = DeepSeekClient(api_key=deepseek_api_key)

        # Generate insights based on component
        generator = InsightsGenerator(llm_client)
        result = None

        if component == 'game_results':
            result = generator.generate_game_results_insights(
                username=username,
                enriched_games=report.enriched_games,
                elo_averages_data=elo_averages_data,
                elo_chart_data=report.elo_chart_data
            )
        elif component == 'mistakes_analysis':
            result = generator.generate_mistakes_insights(
                username=username,
                stockfish_analysis=report.stockfish_analysis,
                elo_averages_data=elo_averages_data
            )
        elif component == 'blunder_analysis':
            result = generator.generate_blunder_insights(
                username=username,
                stockfish_analysis=report.stockfish_analysis,
                elo_averages_data=elo_averages_data
            )
        elif component == 'time_analysis':
            result = generator.generate_time_insights(
                username=username,
                stockfish_analysis=report.stockfish_analysis,
                elo_averages_data=elo_averages_data
            )
        else:
            return JsonResponse({
                'success': False,
                'error': f'Unsupported component: {component}'
            }, status=400)

        if result and result['success']:
            # Store the insights in the report
            if not report.llm_insights:
                report.llm_insights = {}

            report.llm_insights[component] = {
                'insights': result['insights'],
                'generated_at': timezone.now().isoformat(),
                'tokens_used': result.get('tokens_used'),
                'metadata': result.get('metadata', {})
            }
            report.save()

            return JsonResponse({
                'success': True,
                'insights': result['insights'],
                'cached': False,
                'tokens_used': result.get('tokens_used'),
                'metadata': result.get('metadata', {})
            })
        else:
            return JsonResponse({
                'success': False,
                'error': result.get('error', 'Unknown error generating insights') if result else 'Failed to generate insights'
            }, status=500)

    except Exception as e:
        import traceback
        traceback.print_exc()
        return JsonResponse({
            'success': False,
            'error': str(e)
        }, status=500)
