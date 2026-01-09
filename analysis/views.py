from django.shortcuts import render, redirect, get_object_or_404
from django.contrib.auth.decorators import login_required
from django.contrib.auth import login, logout, update_session_auth_hash
from django.contrib.auth.forms import PasswordChangeForm
from django.contrib.auth.models import User
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

from .models import UserProfile, GameDataSet, AnalysisReport, ChessGame, ReportGenerationTask
from chessdotcom import get_player_profile, get_player_game_archives, get_player_games_by_month, Client, get_current_daily_puzzle
from django.core.cache import cache
from .chess_analysis import ChessAnalyzer
from .chess_analysis.game_enricher import GameEnricher
from django.http import StreamingHttpResponse
from .report_generation import generate_html_report


# Number of games to analyze (change this to analyze more/fewer games)
ANALYSIS_GAME_COUNT = 5


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
        oldest_date, newest_date = track_game_dates(
            games_data,
            lambda game: getattr(game, 'end_time', 0)
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


def get_lichess_user_games(access_token, username, max_games=ANALYSIS_GAME_COUNT):
    """Fetch recent games from Lichess API with configurable game count"""
    response = requests.get(
        f"https://lichess.org/api/games/user/{username}",
        headers={
            "Authorization": f"Bearer {access_token}",
            "Accept": "application/x-ndjson",
        },
        params={
            "max": max_games,
            "moves": "true",
            "tags": "true",
            "clocks": "true",
            "evals": "true",
            "accuracy": "true",
            "opening": "true",
            "division": "true",
            "finished": "true",
            "sort": "dateDesc",
        },
    )

    if response.status_code == 200:
        ndjson_data = response.text
        lines = [line for line in ndjson_data.strip().split('\n') if line.strip()]
        games = []

        # Parse games
        for line in lines:
            try:
                game = json.loads(line)
                games.append(game)
            except json.JSONDecodeError:
                continue

        # Use shared utility to track dates
        oldest_date, newest_date = track_game_dates(
            games,
            lambda game: game.get('createdAt')
        )

        return {
            'games': games,
            'ndjson_data': ndjson_data,
            'games_count': len(games),
            'oldest_game_date': oldest_date,
            'newest_game_date': newest_date
        }

    return {
        'games': [],
        'ndjson_data': '',
        'games_count': 0,
        'oldest_game_date': None,
        'newest_game_date': None
    }


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


def games(request):
    """Games page with interactive chess mini-games"""
    return render(request, 'analysis/games.html')


def lichess_login(request):
    """Initiate Lichess OAuth flow or redirect to analysis if already connected"""
    # Check if user is authenticated and already has a connected Lichess account
    if request.user.is_authenticated:
        try:
            profile = UserProfile.objects.get(user=request.user)
            if profile.lichess_username and profile.lichess_access_token:
                # User is already connected, redirect directly to analysis
                return redirect('analysis:user_analysis', username=profile.lichess_username)
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

        return redirect('analysis:user_analysis', username=lichess_username)

    except Exception as e:
        return HttpResponse(f"Authentication error: {str(e)}", status=500)


@login_required
def user_analysis(request, username):
    """Render Lichess analysis page immediately, then fetch games asynchronously"""
    # Get access token
    profile = get_object_or_404(UserProfile, user=request.user, lichess_username=username)
    access_token = profile.lichess_access_token

    if not access_token:
        messages.error(request, "No valid Lichess authentication found")
        return redirect('analysis:lichess_login')

    # Render page immediately without waiting for games
    return render(request, 'analysis/user_analysis.html', {
        'username': username,
        'loading': True  # Indicate we're in loading state
    })

@login_required
def fetch_lichess_games(request, username):
    """AJAX endpoint to fetch Lichess games asynchronously"""
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

        # Fetch games with configurable count
        game_data = get_lichess_user_games(access_token, username, max_games=max_games)

        if game_data['games_count'] == 0:
            return JsonResponse({
                'success': False,
                'error': 'No games found for this account'
            })

        # Create GameDataSet using shared utility
        game_dataset = create_game_dataset(
            user=request.user,
            username=username,
            games_data=game_data['games'],
            ndjson_data=game_data['ndjson_data'],
            platform='lichess'
        )

        # Format date range using shared utility
        date_range_str = format_date_range_for_display(
            game_data['oldest_game_date'],
            game_data['newest_game_date']
        )

        return JsonResponse({
            'success': True,
            'games_count': game_data['games_count'],
            'game_dataset_id': game_dataset.id,
            'created_at': game_dataset.created_at.strftime("%B %d, %Y %I:%M %p"),
            'data_size': len(game_data['ndjson_data']),
            'date_range': date_range_str,
            'oldest_game_date': game_data['oldest_game_date'].strftime("%B %d, %Y") if game_data['oldest_game_date'] else None,
            'newest_game_date': game_data['newest_game_date'].strftime("%B %d, %Y") if game_data['newest_game_date'] else None
        })

    except Exception as e:
        return JsonResponse({
            'success': False,
            'error': str(e)
        })


def _render_completed_report(request, report, platform, username, game_dataset):
    """Render a completed analysis report"""
    # Get ALL games from raw data for display
    all_games_raw = "No game data available"
    try:
        if game_dataset.raw_data:
            lines = game_dataset.raw_data.strip().split('\n')
            all_games = []
            for line in lines:  # ALL games
                if line.strip():
                    try:
                        game_data = json.loads(line)
                        # Show raw data as-is, no conversion needed for raw display
                        all_games.append(game_data)
                    except json.JSONDecodeError:
                        continue
            if all_games:
                all_games_raw = json.dumps(all_games, indent=2)
    except Exception as e:
        all_games_raw = f"Error parsing game data: {e}"

    # Get enriched games for display
    enriched_games_display = "No enriched game data available"
    if report.enriched_games:
        enriched_games_display = json.dumps(report.enriched_games, indent=2)

    return render(request, 'analysis/report.html', {
        'username': username,
        'dataset_id': game_dataset.id,
        'all_games_raw': all_games_raw,
        'enriched_games': enriched_games_display,
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

    # Get ALL games from raw data for display
    all_games_raw = "Loading..."
    try:
        if game_dataset.raw_data:
            lines = game_dataset.raw_data.strip().split('\n')
            all_games = []  # Store all games for display
            for line in lines:  # Process ALL games
                if line.strip():
                    try:
                        game_data = json.loads(line)
                        # Show raw data as-is, no conversion needed for raw display
                        all_games.append(game_data)
                    except json.JSONDecodeError:
                        continue

            if all_games:
                all_games_raw = json.dumps(all_games, indent=2)

    except Exception as e:
        all_games_raw = f"Error parsing game data: {e}"

    # Show the unified report page
    return render(request, 'analysis/report.html', {
        'username': username,
        'dataset_id': dataset_id,
        'all_games_raw': all_games_raw,
        'enriched_games': json.dumps({"status": "Waiting for analysis to complete..."}, indent=2),
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
                        "enriched_games_count": len(report.enriched_games) if report.enriched_games else 0
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

        return JsonResponse({
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
            # Configure User-Agent for chess.com API
            Client.request_config["headers"]["User-Agent"] = (
                "Learn Chess Like a Computer - Chess Analysis Tool. "
                "Contact: admin@learnchesslikeacomputer.com"
            )

            # Get player profile from chess.com
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


@login_required
def chess_com_analysis(request, username):
    """Render Chess.com analysis page immediately, then fetch games asynchronously"""
    # Verify this is the user's chess.com account
    profile = get_object_or_404(UserProfile, user=request.user, chess_com_username=username)

    # Render page immediately without waiting for games
    return render(request, 'analysis/chess_com_analysis.html', {
        'username': username,
        'loading': True  # Indicate we're in loading state
    })

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


# Global cache for opening database
_opening_database = None


def load_opening_database():
    """Load and parse the lichess ECO database with FEN positions"""
    global _opening_database

    if _opening_database is not None:
        return _opening_database

    try:
        import os
        import csv
        import re
        from django.conf import settings

        # Path to the TSV file
        tsv_path = os.path.join(settings.BASE_DIR, 'static', 'data', 'openings', 'lichess_eco_database.tsv')

        _opening_database = []

        with open(tsv_path, 'r', encoding='utf-8') as file:
            reader = csv.DictReader(file, delimiter='\t')
            for row in reader:
                # Extract moves from PGN and convert to list
                pgn_moves = row['pgn'].strip()
                epd_fen = row['epd'].strip()

                if not pgn_moves or not epd_fen:
                    continue

                # Remove move numbers like "1. ", "2. " etc and split into moves
                # Handle patterns like "1. Nh3", "1. Nh3 d5 2. g3 e5 3. f4"
                moves_only = re.sub(r'\d+\.\s*', '', pgn_moves).strip()
                moves_list = moves_only.split() if moves_only else []

                _opening_database.append({
                    'eco': row['eco'].strip(),
                    'name': row['name'].strip(),
                    'moves': moves_list,
                    'ply_count': len(moves_list),
                    'fen': epd_fen
                })

        # Sort by ply count descending for backward matching (deepest positions first)
        _opening_database.sort(key=lambda x: x['ply_count'], reverse=True)

        print(f"Loaded {len(_opening_database)} openings from database")

        return _opening_database

    except Exception as e:
        print(f"Error loading opening database: {e}")
        return []


def normalize_fen(fen):
    """Normalize FEN by removing move counters and keeping only position data"""
    # FEN format: position castling en_passant halfmove fullmove
    # Database EPD format: position castling en_passant halfmove (no fullmove)
    # We want to match the database format
    parts = fen.split()
    if len(parts) >= 4:
        return ' '.join(parts[:4])  # Keep position, castling, en_passant, halfmove
    return fen


def moves_to_fen_positions(moves_string):
    """Convert a moves string to a list of normalized FEN positions at each move"""
    if not moves_string:
        return []

    try:
        import chess

        board = chess.Board()
        fen_positions = []

        moves_list = moves_string.strip().split()

        for move_str in moves_list:
            try:
                move = board.parse_san(move_str)
                board.push(move)
                # Normalize FEN to match database format
                normalized_fen = normalize_fen(board.fen())
                fen_positions.append(normalized_fen)
            except (chess.InvalidMoveError, chess.IllegalMoveError):
                # Stop at first invalid move
                break

        return fen_positions

    except Exception as e:
        print(f"Error converting moves to FEN: {e}")
        return []


def classify_opening_by_moves(moves_string):
    """
    Classify opening by FEN-based backward matching (handles transpositions)

    Args:
        moves_string: Space-separated moves like "Nf3 e6 e4 d5 e5 c5"

    Returns:
        dict with 'eco', 'name', and 'ply' keys
    """
    if not moves_string:
        return {'eco': 'Unknown', 'name': 'Unknown', 'ply': 0}

    try:
        database = load_opening_database()
        if not database:
            return {'eco': 'Unknown', 'name': 'Unknown', 'ply': 0}

        # Convert moves to FEN positions
        fen_positions = moves_to_fen_positions(moves_string)
        if not fen_positions:
            return {'eco': 'Unknown', 'name': 'Unknown', 'ply': 0}

        # Try backward matching - start from move 20 (40th ply) or end of game, whichever is shorter
        max_check_moves = min(40, len(fen_positions))

        # Go backwards through positions to find the deepest (most specific) match
        for check_ply in range(max_check_moves, 0, -1):
            game_fen = fen_positions[check_ply - 1]  # Convert to 0-based index

            # Look for exact FEN match in database
            for opening in database:
                if opening['ply_count'] == check_ply and opening['fen'] == game_fen:
                    return {
                        'eco': opening['eco'],
                        'name': opening['name'],
                        'ply': opening['ply_count']
                    }

        # No match found
        return {'eco': 'Unknown', 'name': 'Unknown', 'ply': 0}

    except Exception as e:
        print(f"Error classifying opening: {e}")
        return {'eco': 'Unknown', 'name': 'Unknown', 'ply': 0}


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


def convert_chess_com_to_lichess_format(chess_com_game):
    """Convert Chess.com game data to Lichess format for unified processing"""
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
            "opening": {
                "eco": opening_classification['eco'],
                "name": opening_classification['name'],
                "ply": opening_classification['ply']
            },
            "moves": moves_string,
            "clocks": clocks_list,
            "clock": {
                "initial": initial_time,
                "increment": increment,
                "totalTime": initial_time + increment  # Approximate total time
            },

            # Preserve Chess.com specific data
            "chess_com_data": {
                "url": chess_com_game.get('url', ''),
                "pgn": chess_com_game.get('pgn', ''),
                "time_control": chess_com_game.get('time_control', ''),
                "end_time": chess_com_game.get('end_time', 0),
                "uuid": chess_com_game.get('uuid', ''),
                "initial_setup": chess_com_game.get('initial_setup', ''),
                "fen": chess_com_game.get('fen', ''),
                "time_class": chess_com_game.get('time_class', ''),
                "rules": chess_com_game.get('rules', 'chess'),
                "eco_url": chess_com_game.get('eco', ''),
                "accuracies": chess_com_game.get('accuracies', {})
            }
        }

        return lichess_format

    except Exception as e:
        print(f"Error converting Chess.com game to Lichess format: {e}")
        # Return minimal format to prevent crashes
        return {
            "id": chess_com_game.get('uuid', 'unknown'),
            "error": f"Conversion failed: {str(e)}",
            "chess_com_data": chess_com_game
        }


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
    """AJAX endpoint to fetch Chess.com games asynchronously"""
    # Verify this is the user's chess.com account
    profile = get_object_or_404(UserProfile, user=request.user, chess_com_username=username)

    try:
        # Get max_games from request (default to analysis setting)
        max_games = int(request.GET.get('max_games', ANALYSIS_GAME_COUNT))

        # Validate max_games to prevent abuse
        if max_games < 1 or max_games > 1000:
            max_games = ANALYSIS_GAME_COUNT

        # Configure User-Agent for chess.com API
        Client.request_config["headers"]["User-Agent"] = (
            "Learn Chess Like a Computer - Chess Analysis Tool. "
            "Contact: admin@learnchesslikeacomputer.com"
        )

        # Get player's game archives to find most recent games
        archives_response = get_player_game_archives(username)

        if not archives_response.archives:
            return JsonResponse({
                'success': False,
                'error': 'No game archives found for this Chess.com account.'
            })

        # Smart fetching strategy to minimize API calls while getting the requested number of games
        all_games = []
        total_fetched = 0
        max_api_calls = min(20, max_games // 20 + 5)  # Scale API calls based on requested games
        api_calls_made = 0

        # Start from most recent and work backwards
        archives_to_check = list(reversed(archives_response.archives))

        for archive_url in archives_to_check:
            if total_fetched >= max_games or api_calls_made >= max_api_calls:
                break

            # Extract year and month from URL
            url_parts = archive_url.split('/')
            year = url_parts[-2]
            month = url_parts[-1]

            try:
                games_response = get_player_games_by_month(username, year, month)
                api_calls_made += 1

                if games_response.games:
                    games_in_month = len(games_response.games)

                    # Add games to our collection (most recent first)
                    games_to_add = min(games_in_month, max_games - total_fetched)
                    for i in range(games_to_add):
                        all_games.append(games_response.games[i])
                        total_fetched += 1

                    print(f"Fetched {games_to_add} games from {year}/{month} (Total: {total_fetched})")

                    # Return progress update
                    if request.GET.get('stream') == 'true':
                        return JsonResponse({
                            'success': True,
                            'progress': True,
                            'games_fetched': total_fetched,
                            'archives_checked': api_calls_made,
                            'current_period': f"{year}/{month}"
                        })
                else:
                    print(f"No games found in {year}/{month}")

            except Exception as e:
                print(f"Error fetching games for {year}/{month}: {e}")
                api_calls_made += 1  # Count failed requests too
                continue

        print(f"Final result: {total_fetched} games fetched using {api_calls_made} API calls")

        if not all_games:
            return JsonResponse({
                'success': False,
                'error': 'No games found in recent archives.'
            })

        # Convert games to NDJSON format and convert to standard format
        ndjson_lines = []
        games_dict_format = []

        for game in all_games:
            try:
                game_data = convert_chess_com_game_to_dict(game)
                games_dict_format.append(game_data)
                ndjson_lines.append(json.dumps(game_data))
            except Exception as e:
                print(f"Error processing game: {e}")
                continue

        ndjson_data = '\n'.join(ndjson_lines)

        # Create GameDataSet using shared utility
        game_dataset = create_game_dataset(
            user=request.user,
            username=username,
            games_data=all_games,  # Use raw Chess.com objects for date extraction
            ndjson_data=ndjson_data,
            platform='chess.com'
        )

        # Format date range using shared utility
        date_range_str = format_date_range_for_display(
            game_dataset.oldest_game_date,
            game_dataset.newest_game_date
        )

        return JsonResponse({
            'success': True,
            'games_count': len(all_games),
            'game_dataset_id': game_dataset.id,
            'date_range': date_range_str or "Date range unavailable",
            'created_at': game_dataset.created_at.strftime("%B %d, %Y at %I:%M %p"),
            'data_size': len(ndjson_data)
        })

    except Exception as e:
        print(f"Error fetching Chess.com games: {e}")
        return JsonResponse({
            'success': False,
            'error': str(e)
        })


@login_required
def generate_chess_com_analysis_report(request, username, dataset_id):
    """Generate Chess.com analysis report using unified template (DEPRECATED - use generate_analysis_report)"""
    return _generate_unified_analysis_report(request, username, dataset_id)


@login_required
def settings(request):
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
            password_form = PasswordChangeForm(user, request.POST)
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
    password_form = PasswordChangeForm(user)

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
    """
    from django.utils import timezone
    import pytz
    from datetime import datetime, timedelta

    # Create cache key that includes the date to ensure daily refresh
    est = pytz.timezone('US/Eastern')
    now_est = timezone.now().astimezone(est)
    current_date = now_est.strftime('%Y-%m-%d')
    cache_key = f'daily_puzzle_{current_date}'

    puzzle_data = cache.get(cache_key)

    if puzzle_data:
        return puzzle_data

    try:
        # Configure User-Agent for Chess.com API
        Client.request_config["headers"]["User-Agent"] = (
            "Learn Chess Like a Computer - Chess Analysis Tool. "
            "Contact: admin@learnchesslikeacomputer.com"
        )

        # Fetch daily puzzle from Chess.com
        response = get_current_daily_puzzle()

        if response and response.puzzle:
            puzzle = response.puzzle

            # Extract solution moves from PGN
            solution_moves = extract_solution_from_pgn(puzzle.pgn)

            puzzle_data = {
                'title': puzzle.title or 'Chess.com Daily Puzzle',
                'fen': puzzle.fen,
                'pgn': puzzle.pgn,
                'url': puzzle.url,
                'image': puzzle.image,
                'solution': solution_moves,
                'publish_time': puzzle.publish_time,
                'publish_datetime': getattr(puzzle, 'publish_datetime', None),
                'source': 'chess.com'
            }

            # Cache until next 12:05 AM EST (when new puzzle is released)
            cache_timeout = get_seconds_until_next_puzzle_release()
            cache.set(cache_key, puzzle_data, cache_timeout)

            return puzzle_data

    except Exception as e:
        print(f"Error fetching daily puzzle: {e}")

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

            puzzle_data = {
                'id': puzzle['id'],
                'title': f"Lichess Daily Puzzle - Rating {puzzle['rating']}",
                'fen': puzzle_fen,
                'solution': solution_moves,
                'url': f"https://lichess.org/training/{puzzle['id']}",
                'rating': puzzle['rating'],
                'plays': puzzle['plays'],
                'themes': puzzle['themes'],
                'source': 'lichess'
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

        # Play moves up to initial_ply
        for i in range(min(initial_ply, len(moves))):
            board.push(moves[i])

        # Convert UCI moves to algebraic
        algebraic_moves = []
        for uci_move in uci_moves:
            try:
                move = chess.Move.from_uci(uci_move)
                if move in board.legal_moves:
                    algebraic = board.san(move)
                    algebraic_moves.append(algebraic)
                    board.push(move)
                else:
                    break
            except:
                break

        return algebraic_moves

    except Exception as e:
        print(f"Error converting UCI to algebraic: {e}")
        return []


def get_position_fen_from_pgn(pgn, initial_ply):
    """
    Get FEN position from PGN at a specific ply
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

        # Play moves up to initial_ply
        for i in range(min(initial_ply, len(moves))):
            board.push(moves[i])

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
                    if move and not move.startswith('(') and not move.endswith(')'):
                        # Remove result indicators like 1-0, 0-1, 1/2-1/2
                        if move not in ['1-0', '0-1', '1/2-1/2', '*']:
                            moves.append(move)

        return moves[:10]  # Limit to reasonable number of moves

    except Exception as e:
        print(f"Error parsing PGN: {e}")
        return []


def get_fallback_puzzle():
    """
    Return a fallback puzzle when API fails
    """
    return {
        'title': 'Chess.com Puzzle (Fallback)',
        'fen': 'r1bqk2r/pppp1ppp/2n2n2/2b1p3/2B1P3/3P1N2/PPP2PPP/RNBQK2R w KQkq - 4 4',
        'pgn': '1. Bxf7+ Kf8 2. Qh5',
        'url': 'https://chess.com/puzzles',
        'image': None,
        'solution': ['Bxf7+', 'Kf8', 'Qh5'],
        'publish_time': None,
        'publish_datetime': None,
        'source': 'chess.com',
        'fallback': True
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
def export_unified_games_json(request, username):
    """
    Export all games for a user in unified format (Lichess-evaluated + enriched)
    Returns a single JSON file with all games in identical format
    """
    try:
        # Get the most recent game dataset for this user
        game_dataset = GameDataSet.objects.filter(
            user_profile__lichess_username=username,
            user_profile__user=request.user
        ).order_by('-created_at').first()

        if not game_dataset:
            return JsonResponse({
                'error': 'No game data found for this user'
            }, status=404)

        # Get all games from this dataset
        games = ChessGame.objects.filter(dataset=game_dataset).select_related('dataset')

        unified_games = []
        lichess_evaluated_count = 0
        enriched_count = 0

        for game in games:
            try:
                raw_json = game.raw_json

                # Check if game already has Lichess evaluation
                has_lichess_evaluation = False
                if 'players' in raw_json:
                    for color in ['white', 'black']:
                        if (color in raw_json['players'] and
                            'analysis' in raw_json['players'][color] and
                            raw_json['players'][color]['analysis'].get('accuracy') is not None):
                            has_lichess_evaluation = True
                            break

                # Also check if game has analysis array with judgments
                if not has_lichess_evaluation and 'analysis' in raw_json:
                    for move in raw_json['analysis']:
                        if 'judgment' in move:
                            has_lichess_evaluation = True
                            break

                if has_lichess_evaluation:
                    lichess_evaluated_count += 1
                else:
                    enriched_count += 1

                # Add game to unified format (already processed by enricher if needed)
                unified_game = {
                    'id': raw_json.get('id', ''),
                    'white_player': game.white_player,
                    'black_player': game.black_player,
                    'opening': game.opening,
                    'result': raw_json.get('winner', 'unknown'),
                    'rated': raw_json.get('rated', False),
                    'speed': raw_json.get('speed', ''),
                    'time_control': raw_json.get('clock', {}),
                    'played_at': raw_json.get('createdAt', 0),
                    'raw_json': raw_json
                }

                unified_games.append(unified_game)

            except Exception as e:
                print(f"Error processing game {game.id}: {e}")
                continue

        # Prepare response
        response_data = {
            'metadata': {
                'username': username,
                'total_games': len(unified_games),
                'lichess_evaluated_games': lichess_evaluated_count,
                'enriched_games': enriched_count,
                'export_timestamp': timezone.now().isoformat(),
                'dataset_created': game_dataset.created_at.isoformat()
            },
            'games': unified_games
        }

        # Return as downloadable JSON file
        response = HttpResponse(
            json.dumps(response_data, indent=2),
            content_type='application/json'
        )
        response['Content-Disposition'] = f'attachment; filename="{username}_chess_games_unified.json"'

        return response

    except Exception as e:
        return JsonResponse({
            'error': f'Failed to export games: {str(e)}'
        }, status=500)
