#!/usr/bin/env python
"""
Test script to enrich a single Lichess game with evaluation data
"""
import os
import sys
import django
import json

# Setup Django environment
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'chess_analysis.settings')
django.setup()

from analysis.chess_analysis.game_enricher import GameEnricher

# Test game data
test_game_json = {
    "id": "VkCaVXJq",
    "rated": True,
    "variant": "standard",
    "speed": "blitz",
    "perf": "blitz",
    "createdAt": 1767762448524,
    "lastMoveAt": 1767763231079,
    "status": "mate",
    "source": "pool",
    "players": {
        "white": {
            "user": {
                "name": "jersonm",
                "id": "jersonm"
            },
            "rating": 1261,
            "ratingDiff": 7,
        },
        "black": {
            "user": {
                "name": "megaloblasto",
                "id": "megaloblasto"
            },
            "rating": 1264,
            "ratingDiff": -16,
        }
    },
    "fullId": "VkCaVXJqn9u9",
    "winner": "white",
    "opening": {
        "eco": "D06",
        "name": "Queen's Gambit Declined: Marshall Defense",
        "ply": 4
    },
    "moves": "d4 d5 c4 Nf6 cxd5 Nxd5 e4 Nb6 Nc3 e6 Nf3 Bb4 a3 Bxc3+ bxc3 O-O Bd3 h6 c4 Nc6 c5 Nd7 Bc4 b6 Qa4 Bb7 O-O Nf6 e5 Ne4 Bd3 Nxe5 Nxe5 Nc3 Qc4 Nd5 cxb6 axb6 Nc6 Qd6 Ne5 c6 Re1 f6 Nf3 e5 dxe5 fxe5 Nxe5 b5 Qe4 g6 Qxg6+ Qxg6 Nxg6 Rf6 Ne7+ Nxe7 Rxe7 Ba6 Bb2 Rf5 Rg7+ Kf8 Bxf5 Re8 Rh7 b4 Rh8+ Ke7 Rxe8+ Kxe8 axb4 Bb5 h4 Ke7 Ra7+ Kd6 Rd7#",
    "clocks": [
        30003, 30003, 30211, 29579, 30251, 29371, 30459, 28827, 28467, 28723,
        28347, 28739, 28267, 28579, 28563, 28755, 28275, 27635, 28339, 24811,
        25427, 24515, 24251, 23307, 22267, 20259, 22219, 19803, 20203, 18955,
        19099, 15907, 17491, 15371, 15331, 13043, 12707, 11939, 12387, 11331,
        11195, 9899, 11283, 7531, 10659, 7123, 10307, 7163, 9419, 6987,
        7899, 3411, 7363, 3539, 7523, 3067, 7427, 3075, 7731, 2443,
        7363, 1819, 7243, 1827, 6555, 1139, 5787, 829, 5155, 828,
        5355, 1131, 5091, 1099, 5131, 1219, 5259, 1403, 4953
    ],
    "clock": {
        "initial": 300,
        "increment": 3,
        "totalTime": 420
    },
    "division": {
        "middle": 28,
        "end": 65
    }
}

# Convert to game format expected by enricher
game = {
    "white_player": "jersonm",
    "black_player": "megaloblasto",
    "opening": "Queen's Gambit Declined: Marshall Defense",
    "raw_json": test_game_json
}

print("=" * 80)
print("TESTING GAME ENRICHMENT")
print("=" * 80)
print(f"\nGame ID: {test_game_json['id']}")
print(f"Players: {game['white_player']} vs {game['black_player']}")
print(f"Opening: {game['opening']}")
print(f"\nGame has existing analysis: {bool(test_game_json.get('players', {}).get('white', {}).get('analysis'))}")

# Check if game needs analysis
raw_json = game.get("raw_json", {})
players_data = raw_json.get("players", {})
white_analysis = players_data.get("white", {}).get("analysis", {})
user_has_accuracy = white_analysis.get("accuracy") is not None

print(f"Game has accuracy data: {user_has_accuracy}")
print(f"White accuracy: {white_analysis.get('accuracy')}")

# Create enricher with single game
enricher = GameEnricher([game])

print("\n" + "=" * 80)
print("STARTING ENRICHMENT STREAMING")
print("=" * 80)

# Track enrichment progress
username = "jersonm"
for i, update in enumerate(enricher.enrich_games_with_stockfish_streaming(username)):
    update_type = update.get('type')
    print(f"\n[Update {i}] Type: {update_type}")

    if update_type == 'init':
        print(f"  Total positions: {update.get('total_positions')}")
        print(f"  Total games: {update.get('total_games')}")
        print(f"  Message: {update.get('message')}")

    elif update_type == 'api_progress':
        print(f"  Completed calls: {update.get('completed_calls')}")
        print(f"  Total calls: {update.get('total_calls')}")
        print(f"  Phase: {update.get('current_phase')}")

    elif update_type == 'game_complete':
        print(f"  Game index: {update.get('game_index')}")
        print(f"  Completed games: {update.get('completed_games')}/{update.get('total_games')}")

        game_analysis = update.get('game_analysis', {})
        if game_analysis and 'game' in game_analysis:
            enriched_game = game_analysis['game']
            enriched_json = enriched_game.get('raw_json', {})

            # Check for analysis array
            analysis_array = enriched_json.get('analysis', [])
            print(f"  Analysis array length: {len(analysis_array)}")

            # Show first few analysis entries
            if analysis_array:
                print("\n  First 5 analysis entries:")
                for j, entry in enumerate(analysis_array[:5]):
                    print(f"    [{j}] {entry}")

    elif update_type == 'complete':
        print(f"  Completed games: {update.get('completed_games')}")
        print(f"  Total games: {update.get('total_games')}")
        print(f"  Total positions: {update.get('total_positions')}")

print("\n" + "=" * 80)
print("FINAL ENRICHED GAME DATA")
print("=" * 80)

# Print final enriched game
final_json = game.get('raw_json', {})
final_analysis = final_json.get('analysis', [])

print(f"\nFinal analysis array length: {len(final_analysis)}")
print(f"\n{'=' * 80}")
print("COMPLETE ANALYSIS ARRAY:")
print('=' * 80)

# Print the entire analysis array as formatted JSON
print(json.dumps(final_analysis, indent=2))

print(f"\n{'=' * 80}")

# Check if any "best" moves are still in UCI format
uci_count = 0
san_count = 0
for entry in final_analysis:
    if entry and isinstance(entry, dict):
        best = entry.get('best')
        if best:
            # Check if looks like UCI (4-5 chars, starts with letter+digit)
            if len(best) in [4, 5] and best[0].isalpha() and best[1].isdigit():
                uci_count += 1
            else:
                san_count += 1

print(f"UCI vs SAN count in 'best' moves:")
print(f"  UCI format: {uci_count}")
print(f"  SAN format: {san_count}")
print("=" * 80)
