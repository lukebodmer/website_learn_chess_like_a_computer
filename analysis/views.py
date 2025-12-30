from django.shortcuts import render, redirect, get_object_or_404
from django.contrib.auth.decorators import login_required
from django.contrib.auth import login, logout
from django.http import HttpResponse, JsonResponse
from django.conf import settings
from django.urls import reverse
from django.utils import timezone
from django.contrib import messages
from datetime import datetime, timedelta
import os
import base64
import hashlib
import secrets
import urllib.parse
import requests
import json
import tempfile

from .models import UserProfile, GameDataSet, AnalysisReport, ChessGame
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
    return render(request, 'analysis/home.html')


def lichess_login(request):
    """Initiate Lichess OAuth flow"""
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
        return render(request, 'analysis/report.html', {
            'username': username,
            'report_html': report_html
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
        return render(request, 'analysis/report.html', {
            'username': username,
            'report_html': report_html
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
    reports = AnalysisReport.objects.filter(user=request.user)
    return render(request, 'analysis/user_reports.html', {'reports': reports})


def custom_logout(request):
    """Custom logout view"""
    logout(request)
    return render(request, 'registration/logged_out.html')
