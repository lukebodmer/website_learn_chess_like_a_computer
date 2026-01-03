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

from .models import UserProfile, GameDataSet, AnalysisReport, ChessGame
from chessdotcom import get_player_profile, get_player_game_archives, get_player_games_by_month, Client, get_current_daily_puzzle
from django.core.cache import cache
from .chess_analysis import ChessAnalyzer
from .report_generation import generate_html_report
from .report_generation.django_report_generator import generate_report_content


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


def get_lichess_user_games(access_token, username, max_games=50):
    """Fetch recent games from Lichess API with date range tracking"""
    response = requests.get(
        f"https://lichess.org/api/games/user/{username}",
        headers={
            "Authorization": f"Bearer {access_token}",
            "Accept": "application/x-ndjson",
        },
        params={
            "max": max_games,  # Limit to exactly what we need
            "moves": "true",
            "tags": "true",
            "clocks": "true",
            "evals": "true",
            "accuracy": "true",
            "opening": "true",
            "division": "true",
            "finished": "true",
            "sort": "dateDesc",  # Ensure most recent first
        },
    )
    if response.status_code == 200:
        ndjson_data = response.text

        # Parse games to extract date range
        lines = [line for line in ndjson_data.strip().split('\n') if line.strip()]
        games = []
        oldest_date = None
        newest_date = None

        for line in lines:
            try:
                game = json.loads(line)
                games.append(game)

                # Track date range using createdAt timestamp
                if 'createdAt' in game:
                    game_date = datetime.fromtimestamp(game['createdAt'] / 1000, tz=timezone.utc)

                    if newest_date is None or game_date > newest_date:
                        newest_date = game_date
                    if oldest_date is None or game_date < oldest_date:
                        oldest_date = game_date

            except json.JSONDecodeError:
                continue

        return {
            'ndjson_data': ndjson_data,
            'games_count': len(games),
            'oldest_game_date': oldest_date,
            'newest_game_date': newest_date
        }

    return {
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
            # Get date range from games in this dataset
            games = ChessGame.objects.filter(
                game_dataset=report.game_dataset
            ).aggregate(
                earliest_game=models.Min('played_at'),
                latest_game=models.Max('played_at')
            )

            report.date_range_start = games['earliest_game']
            report.date_range_end = games['latest_game']
            report.platform = 'Lichess'  # For now, all are Lichess
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
        # Fetch exactly 50 most recent games with date range tracking
        game_data = get_lichess_user_games(access_token, username, max_games=50)

        if game_data['games_count'] == 0:
            return JsonResponse({
                'success': False,
                'error': 'No games found for this account'
            })

        # Create GameDataSet
        game_dataset = GameDataSet.objects.create(
            user=request.user,
            lichess_username=username,
            total_games=game_data['games_count'],
            raw_data=game_data['ndjson_data'],
            oldest_game_date=game_data['oldest_game_date'],
            newest_game_date=game_data['newest_game_date']
        )

        # Format date range for display
        oldest_date_str = None
        newest_date_str = None
        date_range_str = None

        if game_data['oldest_game_date'] and game_data['newest_game_date']:
            oldest_date_str = game_data['oldest_game_date'].strftime("%B %d, %Y")
            newest_date_str = game_data['newest_game_date'].strftime("%B %d, %Y")

            if oldest_date_str == newest_date_str:
                date_range_str = oldest_date_str  # Same day
            else:
                date_range_str = f"{oldest_date_str} - {newest_date_str}"

        return JsonResponse({
            'success': True,
            'games_count': game_data['games_count'],
            'game_dataset_id': game_dataset.id,
            'created_at': game_dataset.created_at.strftime("%B %d, %Y %I:%M %p"),
            'data_size': len(game_data['ndjson_data']),
            'date_range': date_range_str,
            'oldest_game_date': oldest_date_str,
            'newest_game_date': newest_date_str
        })

    except Exception as e:
        return JsonResponse({
            'success': False,
            'error': str(e)
        })


@login_required
def generate_analysis_report(request, username):
    """Generate and display analysis report"""
    # Get the most recent game dataset for this user
    game_dataset = GameDataSet.objects.filter(
        user=request.user,
        lichess_username=username
    ).first()

    if not game_dataset:
        return HttpResponse("No games data found. Please connect your Lichess account first.", status=404)

    # Check if we already have a recent report
    existing_report = AnalysisReport.objects.filter(
        user=request.user,
        game_dataset=game_dataset
    ).first()

    if existing_report:
        # Use existing report
        report_html = generate_report_content({
            'username': username,
            'basic_stats': existing_report.basic_stats,
            'terminations': existing_report.terminations,
            'openings': existing_report.openings,
            'accuracy_analysis': existing_report.accuracy_analysis,
            'stockfish_analysis': existing_report.stockfish_analysis,
        })

        # Get user's games for buddy board from raw NDJSON data
        buddy_board_games = []
        try:
            # Parse games directly from the raw NDJSON data in the dataset
            if game_dataset.raw_data:
                lines = game_dataset.raw_data.strip().split('\n')

                for i, line in enumerate(lines):
                    if not line.strip() or i >= 100:  # Limit to 100 games for performance
                        break

                    try:
                        game_data = json.loads(line)

                        # Extract game information
                        white_player = game_data.get('players', {}).get('white', {}).get('user', {}).get('name', 'Unknown')
                        black_player = game_data.get('players', {}).get('black', {}).get('user', {}).get('name', 'Unknown')

                        # Extract opening information
                        opening_info = game_data.get('opening', {})
                        opening_name = opening_info.get('name', 'Unknown Opening')

                        # Extract moves
                        moves = game_data.get('moves')
                        pgn = game_data.get('pgn')

                        # Skip games without moves
                        if not moves and not pgn:
                            continue

                        # Extract game result
                        result = game_data.get('status')
                        if game_data.get('winner') == 'white':
                            result = '1-0'
                        elif game_data.get('winner') == 'black':
                            result = '0-1'
                        else:
                            result = '1/2-1/2'

                        # Extract date
                        created_at = game_data.get('createdAt')
                        date = 'Unknown'
                        if created_at:
                            try:
                                dt = datetime.fromtimestamp(created_at / 1000, tz=timezone.utc)
                                date = dt.strftime('%Y-%m-%d')
                            except:
                                pass

                        buddy_board_games.append({
                            'white': white_player,
                            'black': black_player,
                            'date': date,
                            'result': result,
                            'opening': opening_name,
                            'moves': moves,
                            'pgn': pgn
                        })

                    except json.JSONDecodeError:
                        continue

        except Exception as e:
            print(f"Error loading buddy board games: {e}")

        return render(request, 'analysis/report.html', {
            'username': username,
            'report_html': report_html,
            'buddy_board_games': json.dumps(buddy_board_games)
        })

    # Generate new analysis
    try:
        # Write NDJSON data to temporary file for analysis
        with tempfile.NamedTemporaryFile(mode='w', suffix='.ndjson', delete=False) as tmp_file:
            tmp_file.write(game_dataset.raw_data)
            tmp_file_path = tmp_file.name

        start_time = timezone.now()

        # Run analysis
        analyzer = ChessAnalyzer(tmp_file_path)
        analysis_data = analyzer.run_analysis(username)

        end_time = timezone.now()
        duration = end_time - start_time

        # Save analysis report
        report = AnalysisReport.objects.create(
            user=request.user,
            game_dataset=game_dataset,
            basic_stats=analysis_data['basic_stats'],
            terminations=analysis_data['terminations'],
            openings=analysis_data['openings'],
            accuracy_analysis=analysis_data['accuracy_analysis'],
            stockfish_analysis=analysis_data['stockfish_analysis'],
            analysis_duration=duration,
            stockfish_games_analyzed=analysis_data['stockfish_analysis'].get('total_games_analyzed', 0)
        )

        # Clean up temporary file
        os.unlink(tmp_file_path)

        # Generate HTML report
        report_html = generate_report_content(analysis_data)

        # Get user's games for buddy board from raw NDJSON data
        buddy_board_games = []
        try:
            # Parse games directly from the raw NDJSON data in the dataset
            if game_dataset.raw_data:
                lines = game_dataset.raw_data.strip().split('\n')

                for i, line in enumerate(lines):
                    if not line.strip() or i >= 100:  # Limit to 100 games for performance
                        break

                    try:
                        game_data = json.loads(line)

                        # Extract game information
                        white_player = game_data.get('players', {}).get('white', {}).get('user', {}).get('name', 'Unknown')
                        black_player = game_data.get('players', {}).get('black', {}).get('user', {}).get('name', 'Unknown')

                        # Extract opening information
                        opening_info = game_data.get('opening', {})
                        opening_name = opening_info.get('name', 'Unknown Opening')

                        # Extract moves
                        moves = game_data.get('moves')
                        pgn = game_data.get('pgn')

                        # Skip games without moves
                        if not moves and not pgn:
                            continue

                        # Extract game result
                        result = game_data.get('status')
                        if game_data.get('winner') == 'white':
                            result = '1-0'
                        elif game_data.get('winner') == 'black':
                            result = '0-1'
                        else:
                            result = '1/2-1/2'

                        # Extract date
                        created_at = game_data.get('createdAt')
                        date = 'Unknown'
                        if created_at:
                            try:
                                dt = datetime.fromtimestamp(created_at / 1000, tz=timezone.utc)
                                date = dt.strftime('%Y-%m-%d')
                            except:
                                pass

                        buddy_board_games.append({
                            'white': white_player,
                            'black': black_player,
                            'date': date,
                            'result': result,
                            'opening': opening_name,
                            'moves': moves,
                            'pgn': pgn
                        })

                    except json.JSONDecodeError:
                        continue

        except Exception as e:
            print(f"Error loading buddy board games: {e}")

        return render(request, 'analysis/report.html', {
            'username': username,
            'report_html': report_html,
            'buddy_board_games': json.dumps(buddy_board_games)
        })

    except Exception as e:
        # Clean up temporary file if it exists
        if 'tmp_file_path' in locals():
            try:
                os.unlink(tmp_file_path)
            except:
                pass
        return HttpResponse(f"Error generating analysis: {str(e)}", status=500)


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


@login_required
def view_report(request, report_id):
    """View an existing analysis report"""
    report = get_object_or_404(AnalysisReport, id=report_id, user=request.user)

    # Generate HTML from existing report data
    report_html = generate_report_content({
        'username': report.game_dataset.lichess_username,
        'basic_stats': report.basic_stats,
        'terminations': report.terminations,
        'openings': report.openings,
        'accuracy_analysis': report.accuracy_analysis,
        'stockfish_analysis': report.stockfish_analysis
    })

    # Get user's games for buddy board from raw NDJSON data
    buddy_board_games = []
    try:
        # Parse games directly from the raw NDJSON data in the dataset
        dataset = report.game_dataset
        if dataset.raw_data:
            lines = dataset.raw_data.strip().split('\n')

            for i, line in enumerate(lines):
                if not line.strip() or i >= 100:  # Limit to 100 games for performance
                    break

                try:
                    game_data = json.loads(line)

                    # Extract game information
                    white_player = game_data.get('players', {}).get('white', {}).get('user', {}).get('name', 'Unknown')
                    black_player = game_data.get('players', {}).get('black', {}).get('user', {}).get('name', 'Unknown')

                    # Check which color the user played
                    user_color = None
                    if white_player.lower() == dataset.lichess_username.lower():
                        user_color = 'white'
                    elif black_player.lower() == dataset.lichess_username.lower():
                        user_color = 'black'

                    # Extract opening information
                    opening_info = game_data.get('opening', {})
                    opening_name = opening_info.get('name', 'Unknown Opening')

                    # Extract moves
                    moves = game_data.get('moves')
                    pgn = game_data.get('pgn')

                    # Skip games without moves
                    if not moves and not pgn:
                        continue

                    # Extract game result
                    winner = game_data.get('winner')
                    if winner == 'white':
                        result = '1-0'
                    elif winner == 'black':
                        result = '0-1'
                    else:
                        result = '1/2-1/2'

                    # Extract ratings
                    white_rating = game_data.get('players', {}).get('white', {}).get('rating', 0)
                    black_rating = game_data.get('players', {}).get('black', {}).get('rating', 0)

                    # Extract date
                    created_at = game_data.get('createdAt')
                    if created_at:
                        # Convert timestamp to date
                        from datetime import datetime
                        game_date = datetime.fromtimestamp(created_at / 1000).strftime('%Y-%m-%d')
                    else:
                        game_date = 'Unknown'

                    # Extract speed/time control
                    speed = game_data.get('speed', 'unknown')

                    # Extract accuracy if available
                    accuracy = None
                    if 'analysis' in game_data:
                        analysis = game_data['analysis']
                        if user_color == 'white' and 'white' in analysis:
                            accuracy = analysis['white'].get('accuracy')
                        elif user_color == 'black' and 'black' in analysis:
                            accuracy = analysis['black'].get('accuracy')

                    buddy_board_games.append({
                        'white': white_player,
                        'black': black_player,
                        'result': result,
                        'opening': opening_name,
                        'date': game_date,
                        'pgn': pgn,
                        'moves': moves,
                        'lichess_id': game_data.get('id', f'game_{i}'),
                        'user_color': user_color,
                        'accuracy': accuracy,
                        'white_rating': white_rating,
                        'black_rating': black_rating,
                        'speed': speed
                    })

                except (json.JSONDecodeError, KeyError, TypeError) as e:
                    print(f"Error parsing game data line {i}: {e}")
                    continue

        print(f"Loaded {len(buddy_board_games)} games with move data for buddy board")

        # Debug: Print some opening names to see what we have
        openings = [game['opening'] for game in buddy_board_games[:10]]
        print(f"Sample openings: {openings}")

    except Exception as e:
        print(f"Error loading buddy board games: {e}")
        # Continue with empty games list

    return render(request, 'analysis/report.html', {
        'username': report.game_dataset.lichess_username,
        'report_html': report_html,
        'buddy_board_games': json.dumps(buddy_board_games)
    })


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

@login_required
def fetch_chess_com_games(request, username):
    """AJAX endpoint to fetch Chess.com games asynchronously"""
    # Verify this is the user's chess.com account
    profile = get_object_or_404(UserProfile, user=request.user, chess_com_username=username)

    try:
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

        # Smart fetching strategy to minimize API calls while getting 50 games
        all_games = []
        total_fetched = 0
        max_api_calls = 10  # Limit to prevent hitting rate limits
        api_calls_made = 0

        # Start from most recent and work backwards
        archives_to_check = list(reversed(archives_response.archives))

        for archive_url in archives_to_check:
            if total_fetched >= 50 or api_calls_made >= max_api_calls:
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
                    games_to_add = min(games_in_month, 50 - total_fetched)
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

        # Convert games to NDJSON format similar to Lichess and track date range
        ndjson_lines = []
        oldest_date = None
        newest_date = None

        for game in all_games:
            # Chess.com API returns Game objects, access attributes directly
            try:
                # Extract and track date from Chess.com game
                end_time = getattr(game, 'end_time', 0)
                if end_time > 0:
                    game_date = datetime.fromtimestamp(end_time, tz=timezone.utc)
                    if newest_date is None or game_date > newest_date:
                        newest_date = game_date
                    if oldest_date is None or game_date < oldest_date:
                        oldest_date = game_date

                # Convert Chess.com game format to a compatible format
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
            except Exception as e:
                print(f"Error processing game: {e}")
                continue

            ndjson_lines.append(json.dumps(game_data))

        ndjson_data = '\n'.join(ndjson_lines)

        # Create GameDataSet for Chess.com
        game_dataset = GameDataSet.objects.create(
            user=request.user,
            lichess_username='',  # Empty for chess.com datasets
            chess_com_username=username,
            total_games=len(all_games),
            raw_data=ndjson_data,
            oldest_game_date=oldest_date,
            newest_game_date=newest_date
        )

        # Format date range for display
        date_range_str = game_dataset.date_range_display if oldest_date and newest_date else "Date range unavailable"

        return JsonResponse({
            'success': True,
            'games_count': len(all_games),
            'game_dataset_id': game_dataset.id,
            'date_range': date_range_str,
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
