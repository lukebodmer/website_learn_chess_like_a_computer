#!/usr/bin/env python
"""
Test script to verify database write-through functionality:
1. Generate analysis for a game (positions go to GCP, then written to DB)
2. Generate analysis for the same game again (positions come from DB)
3. Verify all evaluations come from database on second run
"""
import os
import sys
import django
import json

# Setup Django
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'chess_analysis.settings')
django.setup()

from analysis.chess_analysis.hybrid_analyzer import HybridStockfishAnalyzer


# Sample game for testing - short but interesting
TEST_GAME = {
    "moves": "1. e4 e5 2. Nf3 Nc6 3. Bc4 Nf6 4. d3 Bc5 5. O-O d6 6. c3 O-O 7. Bb3 a6 8. Nbd2 Ba7",
    "white": "Player1",
    "black": "Player2",
    "result": "1-0"
}


def print_section(title):
    """Print a formatted section header"""
    print("\n" + "=" * 70)
    print(f"  {title}")
    print("=" * 70)


def print_evaluation_sources(analysis_result):
    """Print breakdown of evaluation sources"""
    db_count = analysis_result.get('database_evaluations', 0)
    gcp_count = analysis_result.get('stockfish_evaluations', 0)
    existing_count = analysis_result.get('existing_evaluations', 0)
    total = analysis_result.get('total_moves_analyzed', 0)

    print(f"\n📊 Evaluation Sources:")
    print(f"  - Database:   {db_count:3d} evaluations")
    print(f"  - GCP API:    {gcp_count:3d} evaluations")
    print(f"  - Existing:   {existing_count:3d} evaluations")
    print(f"  - Total:      {total:3d} positions analyzed")


def print_evaluations_detail(evaluations):
    """Print detailed evaluation information"""
    print(f"\n📝 Detailed Evaluation Sources:")
    print(f"{'Move':<6} {'Source':<15} {'Eval':>8} {'Additional Info'}")
    print("-" * 70)

    for eval_data in evaluations[:10]:  # Show first 10 positions
        move_num = eval_data.get('move_number', '?')
        move = eval_data.get('move', 'start')
        source = eval_data.get('source', 'unknown')
        eval_val = eval_data.get('eval', 0)

        # Format additional info based on source
        if source == 'database':
            depth = eval_data.get('depth', '?')
            knodes = eval_data.get('knodes', '?')
            info = f"depth={depth}, knodes={knodes}"
        elif source == 'gcp_stockfish':
            depth = eval_data.get('depth', '?')
            time_ms = eval_data.get('time_ms', '?')
            info = f"depth={depth}, time={time_ms}ms"
        else:
            info = ""

        print(f"{move_num:<6} {source:<15} {eval_val:>8} {info}")

    if len(evaluations) > 10:
        print(f"... and {len(evaluations) - 10} more positions")


def test_database_writethrough():
    """Run the complete test"""

    print_section("DATABASE WRITE-THROUGH TEST")
    print(f"\nTest Game: {TEST_GAME['white']} vs {TEST_GAME['black']}")
    print(f"Moves: {TEST_GAME['moves']}")

    analyzer = HybridStockfishAnalyzer()

    # ========================================================================
    # FIRST ANALYSIS - Should use GCP and write to database
    # ========================================================================
    print_section("FIRST ANALYSIS (Cold Cache)")
    print("Analyzing game for the first time...")
    print("Expected: Positions will be sent to GCP API, then written to database")

    result1 = analyzer.analyze_game(TEST_GAME)

    if 'error' in result1:
        print(f"\n❌ ERROR: {result1['error']}")
        return False

    print_evaluation_sources(result1)
    print_evaluations_detail(result1.get('evaluations', []))

    # Check that we got evaluations
    total_analyzed_1 = result1.get('total_moves_analyzed', 0)
    gcp_count_1 = result1.get('stockfish_evaluations', 0)

    if total_analyzed_1 == 0:
        print("\n❌ FAIL: No positions were analyzed!")
        return False

    print(f"\n✓ First analysis complete: {total_analyzed_1} positions analyzed")
    print(f"✓ {gcp_count_1} evaluations from GCP API (expected for first run)")

    # ========================================================================
    # SECOND ANALYSIS - Should use database exclusively
    # ========================================================================
    print_section("SECOND ANALYSIS (Warm Cache)")
    print("Analyzing the same game again...")
    print("Expected: All positions should come from database")

    result2 = analyzer.analyze_game(TEST_GAME)

    if 'error' in result2:
        print(f"\n❌ ERROR: {result2['error']}")
        return False

    print_evaluation_sources(result2)
    print_evaluations_detail(result2.get('evaluations', []))

    # Verify all came from database
    total_analyzed_2 = result2.get('total_moves_analyzed', 0)
    db_count_2 = result2.get('database_evaluations', 0)
    gcp_count_2 = result2.get('stockfish_evaluations', 0)

    print_section("TEST RESULTS")

    success = True

    # Check 1: Same number of positions analyzed
    if total_analyzed_1 != total_analyzed_2:
        print(f"❌ FAIL: Different number of positions analyzed")
        print(f"   First run: {total_analyzed_1}, Second run: {total_analyzed_2}")
        success = False
    else:
        print(f"✓ PASS: Same number of positions analyzed ({total_analyzed_1})")

    # Check 2: Second run should have ZERO GCP evaluations
    if gcp_count_2 > 0:
        print(f"❌ FAIL: Second run used GCP API ({gcp_count_2} positions)")
        print(f"   Expected: All positions should come from database")
        success = False
    else:
        print(f"✓ PASS: Second run used no GCP evaluations (all from database)")

    # Check 3: Second run should have ALL evaluations from database
    if db_count_2 != total_analyzed_2:
        print(f"❌ FAIL: Not all positions came from database")
        print(f"   Database: {db_count_2}, Total: {total_analyzed_2}")
        success = False
    else:
        print(f"✓ PASS: All {db_count_2} positions came from database")

    # Check 4: Evaluations should match
    evaluations_match = True
    evals1 = result1.get('evaluations', [])
    evals2 = result2.get('evaluations', [])

    if len(evals1) == len(evals2):
        for i, (e1, e2) in enumerate(zip(evals1, evals2)):
            if e1.get('eval') != e2.get('eval'):
                print(f"❌ Position {i} evaluations differ: {e1.get('eval')} vs {e2.get('eval')}")
                evaluations_match = False
                success = False
                break
    else:
        print(f"❌ Different number of evaluations: {len(evals1)} vs {len(evals2)}")
        evaluations_match = False
        success = False

    if evaluations_match:
        print(f"✓ PASS: All evaluations match between runs")

    # Final result
    print("\n" + "=" * 70)
    if success:
        print("🎉 ALL TESTS PASSED!")
        print("Database write-through is working correctly:")
        print("  - First run: Positions sent to GCP API")
        print("  - Results written to database")
        print("  - Second run: All positions retrieved from database")
        print("  - Zero GCP API calls on second run")
    else:
        print("❌ TEST FAILED - See errors above")
    print("=" * 70)

    return success


if __name__ == "__main__":
    try:
        success = test_database_writethrough()
        sys.exit(0 if success else 1)
    except Exception as e:
        print(f"\n❌ FATAL ERROR: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)
