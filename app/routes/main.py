from flask import Blueprint, render_template, send_from_directory, request, session, redirect, url_for, jsonify
import os
import base64
import hashlib
import secrets
import urllib.parse
import requests
import json
from datetime import datetime

bp = Blueprint('main', __name__)

CLIENT_ID = 'chess-analysis-app'  # You'll need to register this with Lichess

# OAuth helper functions
def base64_url_encode(data):
    return base64.urlsafe_b64encode(data).decode().rstrip('=')

def create_code_verifier():
    return base64_url_encode(secrets.token_bytes(32))

def create_code_challenge(verifier):
    digest = hashlib.sha256(verifier.encode()).digest()
    return base64_url_encode(digest)

def get_lichess_token(auth_code, verifier, redirect_uri):
    response = requests.post('https://lichess.org/api/token', json={
        'grant_type': 'authorization_code',
        'redirect_uri': redirect_uri,
        'client_id': CLIENT_ID,
        'code': auth_code,
        'code_verifier': verifier,
    })
    return response.json()

def get_lichess_user(access_token):
    response = requests.get('https://lichess.org/api/account',
        headers={'Authorization': f'Bearer {access_token}'})
    return response.json()

def get_lichess_user_games(access_token, username):
    response = requests.get(f'https://lichess.org/api/games/user/{username}',
        headers={
            'Authorization': f'Bearer {access_token}',
            'Accept': 'application/x-chess-pgn'
        },
        params={
            'max': 5000,          # Download up to 5000 games
            'moves': 'true',       # Include moves
            'tags': 'true',        # Include PGN tags
            'clocks': 'true',      # Include clock comments
            'evals': 'true',       # Include evaluation comments
            'opening': 'true',     # Include opening names
            'literate': 'true',    # Include textual annotations about mistakes, etc.
            'finished': 'true'     # Only finished games (default, but explicit)
        })
    if response.status_code == 200:
        return response.text
    return ""


@bp.route('/')
def index():
    return render_template('index.html')


@bp.route('/openings')
def openings():
    return render_template('openings.html')


@bp.route('/openings/<opening_name>')
def opening_analysis(opening_name):
    analysis_file = f"analysis/{opening_name}.html"
    if os.path.exists(os.path.join('app/static', analysis_file)):
        return render_template('analysis_display.html',
                             analysis_file=analysis_file,
                             opening_name=opening_name)
    else:
        return render_template('analysis_not_found.html', opening_name=opening_name), 404


@bp.route('/videos')
def videos():
    return render_template('videos.html')


@bp.route('/contact')
def contact():
    return render_template('contact.html')


@bp.route('/analyze')
def analyze():
    return render_template('analyze.html')


@bp.route('/lichess/login')
def lichess_login():
    base_url = request.url_root.rstrip('/')

    verifier = create_code_verifier()
    challenge = create_code_challenge(verifier)
    state = secrets.token_urlsafe(32)

    session['code_verifier'] = verifier
    session['oauth_state'] = state

    params = {
        'response_type': 'code',
        'client_id': CLIENT_ID,
        'redirect_uri': f'{base_url}/lichess/callback',
        'code_challenge_method': 'S256',
        'code_challenge': challenge,
        'state': state
    }

    auth_url = f"https://lichess.org/oauth?{urllib.parse.urlencode(params)}"
    return redirect(auth_url)


@bp.route('/lichess/callback')
def lichess_callback():
    # Check for authorization errors
    error = request.args.get('error')
    if error:
        error_desc = request.args.get('error_description', 'Unknown error')
        return f'Authorization failed: {error_desc}', 400

    code = request.args.get('code')
    state = request.args.get('state')

    if not code:
        return 'Authorization failed: no code received', 400

    # CSRF protection - verify state parameter
    stored_state = session.get('oauth_state')
    if not stored_state or state != stored_state:
        return 'Invalid state parameter - possible CSRF attack', 400

    verifier = session.get('code_verifier')
    if not verifier:
        return 'Session expired', 400

    base_url = request.url_root.rstrip('/')
    redirect_uri = f'{base_url}/lichess/callback'

    try:
        token_data = get_lichess_token(code, verifier, redirect_uri)

        if not token_data.get('access_token'):
            return 'Failed to get access token', 400

        session['access_token'] = token_data['access_token']
        user_data = get_lichess_user(token_data['access_token'])
        session['username'] = user_data['username']

        # Clean up OAuth session data
        session.pop('code_verifier', None)
        session.pop('oauth_state', None)

        return redirect(url_for('main.analyze_user', username=user_data['username']))

    except Exception as e:
        return f'Authentication error: {str(e)}', 500


@bp.route('/analyze/<username>')
def analyze_user(username):
    access_token = session.get('access_token')
    if not access_token:
        return redirect(url_for('main.lichess_login'))

    try:
        pgn_data = get_lichess_user_games(access_token, username)

        # Create data directory if it doesn't exist
        os.makedirs('data', exist_ok=True)

        # Save PGN data for analysis
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        pgn_filename = f'data/{username}_{timestamp}_games.pgn'
        with open(pgn_filename, 'w', encoding='utf-8') as f:
            f.write(pgn_data)

        # Count games by counting how many times [Event appears
        games_count = pgn_data.count('[Event ')

        return render_template('user_analysis.html',
                             username=username,
                             games_count=games_count,
                             pgn_file=pgn_filename)
    except Exception as e:
        return f'Error fetching games: {str(e)}', 500


@bp.route('/analysis/<username>')
def generate_analysis_report(username):
    """Generate and display the chess analysis report"""
    from app.analysis import ChessAnalyzer, generate_html_report

    # For testing purposes, we'll look for the most recent PGN file for this user
    import glob
    pgn_files = glob.glob(f'data/{username}_*_games.pgn')
    if not pgn_files:
        return 'No games data found. Please connect your Lichess account first.', 404

    # Use the most recent file
    most_recent_file = max(pgn_files)

    try:
        analyzer = ChessAnalyzer(most_recent_file)
        analysis_data = analyzer.run_analysis(username)
        html_report = generate_html_report(analysis_data)

        return html_report
    except Exception as e:
        return f'Error generating analysis: {str(e)}', 500


