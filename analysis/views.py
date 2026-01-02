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

from .models import UserProfile, GameDataSet, AnalysisReport, ChessGame
from chessdotcom import get_player_profile, get_player_game_archives, get_player_games_by_month, Client
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


def get_lichess_user_games(access_token, username):
    response = requests.get(
        f"https://lichess.org/api/games/user/{username}",
        headers={
            "Authorization": f"Bearer {access_token}",
            "Accept": "application/x-ndjson",
        },
        params={
            "max": 5000,
            "moves": "true",
            "tags": "true",
            "clocks": "true",
            "evals": "true",
            "accuracy": "true",
            "opening": "true",
            "division": "true",
            "finished": "true",
        },
    )
    if response.status_code == 200:
        return response.text
    return ""


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
    """Fetch user games and prepare for analysis"""
    # Get access token
    profile = get_object_or_404(UserProfile, user=request.user, lichess_username=username)
    access_token = profile.lichess_access_token

    if not access_token:
        messages.error(request, "No valid Lichess authentication found")
        return redirect('analysis:lichess_login')

    try:
        ndjson_data = get_lichess_user_games(access_token, username)

        # Count games
        games_count = len([line for line in ndjson_data.strip().split('\n') if line.strip()])

        # Create GameDataSet
        game_dataset = GameDataSet.objects.create(
            user=request.user,
            lichess_username=username,
            total_games=games_count,
            raw_data=ndjson_data
        )

        return render(request, 'analysis/user_analysis.html', {
            'username': username,
            'games_count': games_count,
            'game_dataset': game_dataset
        })

    except Exception as e:
        return HttpResponse(f"Error fetching games: {str(e)}", status=500)


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
    """Fetch Chess.com games and prepare for analysis"""
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
            messages.error(request, "No game archives found for this Chess.com account.")
            return redirect('analysis:home')

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
                else:
                    print(f"No games found in {year}/{month}")

            except Exception as e:
                print(f"Error fetching games for {year}/{month}: {e}")
                api_calls_made += 1  # Count failed requests too
                continue

        print(f"Final result: {total_fetched} games fetched using {api_calls_made} API calls")

        if not all_games:
            messages.error(request, "No games found in recent archives.")
            return redirect('analysis:home')

        # Convert games to NDJSON format similar to Lichess
        ndjson_lines = []
        for game in all_games:
            # Chess.com API returns games in JSON format, access as dictionary
            try:
                # Convert Chess.com game format to a compatible format
                game_data = {
                    'url': game.get('url', ''),
                    'pgn': game.get('pgn', ''),
                    'time_control': str(game.get('time_control', '')),
                    'end_time': game.get('end_time', 0),
                    'rated': game.get('rated', True),
                    'uuid': game.get('uuid', ''),
                    'initial_setup': game.get('initial_setup', ''),
                    'fen': game.get('fen', ''),
                    'time_class': game.get('time_class', ''),
                    'rules': game.get('rules', 'chess'),
                    'white': {
                        'rating': game.get('white', {}).get('rating', 0),
                        'result': game.get('white', {}).get('result', ''),
                        'username': game.get('white', {}).get('username', ''),
                        'uuid': game.get('white', {}).get('uuid', '')
                    },
                    'black': {
                        'rating': game.get('black', {}).get('rating', 0),
                        'result': game.get('black', {}).get('result', ''),
                        'username': game.get('black', {}).get('username', ''),
                        'uuid': game.get('black', {}).get('uuid', '')
                    },
                    'eco': game.get('eco', '')
                }

                # Add accuracies if available
                if 'accuracies' in game and game['accuracies']:
                    game_data['accuracies'] = {
                        'white': game['accuracies'].get('white'),
                        'black': game['accuracies'].get('black')
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
            chess_com_username=username,  # We'll need to add this field
            total_games=len(all_games),
            raw_data=ndjson_data
        )

        return render(request, 'analysis/chess_com_analysis.html', {
            'username': username,
            'games_count': len(all_games),
            'game_dataset': game_dataset
        })

    except Exception as e:
        print(f"Error fetching Chess.com games: {e}")
        messages.error(request, f"Error fetching games: {str(e)}")
        return redirect('analysis:home')


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
