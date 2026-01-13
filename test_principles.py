#!/usr/bin/env python
"""
Quick test to verify principles analyzer can handle enriched games
"""
import os
import django

# Setup Django
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'chess_analysis.settings')
django.setup()

from analysis.models import AnalysisReport
from analysis.chess_analysis.principles_analyzer import ChessPrinciplesAnalyzer

# Get the most recent report
report = AnalysisReport.objects.order_by('-created_at').first()

if not report:
    print("No reports found!")
    exit(1)

print(f"Testing with report ID: {report.id}")
print(f"Total enriched games: {len(report.enriched_games)}")

# Get username from report
if report.game_dataset.lichess_username:
    username = report.game_dataset.lichess_username
else:
    username = report.game_dataset.chess_com_username

print(f"Username: {username}")

# Test analyzer
analyzer = ChessPrinciplesAnalyzer(
    enriched_games=report.enriched_games,
    username=username
)

print(f"Filtered user games: {len(analyzer.user_games)}")
print(f"ECO range: {analyzer.eco_range}")

# Test one principle
opening_result = analyzer.calculate_opening_awareness()
print(f"\nOpening Awareness Test:")
print(f"  Games analyzed: {opening_result['raw_metrics'].get('games_analyzed', 0)}")
print(f"  Total errors: {opening_result['raw_metrics'].get('total_opening_errors', 0)}")
print(f"  Importance score: {opening_result['importance_score']}")

print("\n✅ Test completed successfully!")
