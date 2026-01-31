#!/usr/bin/env python
"""
Test script to verify ASYNC database write-through functionality:
1. Generate analysis for a game (positions go to GCP, then QUEUED for DB write)
2. Wait for Celery to process the database writes
3. Generate analysis for the same game again (positions come from DB)
4. Verify all evaluations come from database on second run
"""
import os
import sys
import django
import json
import time

# Setup Django
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'chess_analysis.settings')
django.setup()

from analysis.chess_analysis.hybrid_analyzer import HybridStockfishAnalyzer
from celery.result import AsyncResult
from chess_analysis.celery import app as celery_app


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


def wait_for_celery_task(timeout=30):
    """Wait for any pending Celery tasks to complete"""
    print(f"\n⏳ Waiting up to {timeout}s for Celery to process database writes...")

    # Check Celery worker status
    inspector = celery_app.control.inspect()

    start_time = time.time()
    while time.time() - start_time < timeout:
        try:
            # Get active and reserved tasks
            active = inspector.active()
            reserved = inspector.reserved()

            if active is None and reserved is None:
                print("⚠️  WARNING: No Celery workers detected!")
                print("   Make sure you have Celery workers running:")
                print("   celery -A chess_analysis worker --loglevel=info")
                return False

            total_pending = 0
            if active:
                for worker, tasks in active.items():
                    total_pending += len(tasks)
            if reserved:
                for worker, tasks in reserved.items():
                    total_pending += len(tasks)

            if total_pending == 0:
                print(f"✅ All Celery tasks completed!")
                return True

            print(f"   {total_pending} tasks still processing... ({int(time.time() - start_time)}s elapsed)")
            time.sleep(2)

        except Exception as e:
            print(f"⚠️  Error checking Celery status: {e}")
            time.sleep(2)

    print(f"⏰ Timeout reached after {timeout}s")
    return False


def test_async_database_writethrough():
    """Run the complete test"""

    print_section("ASYNC DATABASE WRITE-THROUGH TEST")
    print(f"\nTest Game: {TEST_GAME['white']} vs {TEST_GAME['black']}")
    print(f"Moves: {TEST_GAME['moves']}")

    analyzer = HybridStockfishAnalyzer()

    # ========================================================================
    # FIRST ANALYSIS - Should use GCP and QUEUE database write
    # ========================================================================
    print_section("FIRST ANALYSIS (Cold Cache)")
    print("Analyzing game for the first time...")
    print("Expected: Positions sent to GCP API, then QUEUED for async database write")

    result1 = analyzer.analyze_game(TEST_GAME)

    if 'error' in result1:
        print(f"\n❌ ERROR: {result1['error']}")
        return False

    total_analyzed_1 = result1.get('total_moves_analyzed', 0)
    gcp_count_1 = result1.get('stockfish_evaluations', 0)

    print(f"\n✓ First analysis complete: {total_analyzed_1} positions analyzed")
    print(f"✓ {gcp_count_1} evaluations from GCP API")
    print(f"✓ Database write task should be queued in Celery")

    # ========================================================================
    # WAIT FOR CELERY
    # ========================================================================
    print_section("WAITING FOR CELERY WORKERS")

    celery_ok = wait_for_celery_task(timeout=30)

    if not celery_ok:
        print("\n⚠️  WARNING: Celery workers may not be running or tasks are slow")
        print("   The test will continue, but may fail if database writes haven't completed")

    # Give a bit more time for database commits to complete
    print("\n⏳ Waiting 3 more seconds for database commits to finalize...")
    time.sleep(3)

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
        print(f"   This likely means Celery workers are not processing the write tasks")
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

    # Final result
    print("\n" + "=" * 70)
    if success:
        print("🎉 ALL TESTS PASSED!")
        print("Async database write-through is working correctly:")
        print("  - First run: Positions sent to GCP API")
        print("  - Database write task queued in Celery")
        print("  - Celery processed the task asynchronously")
        print("  - Second run: All positions retrieved from database")
        print("  - Zero GCP API calls on second run")
    else:
        print("❌ TEST FAILED - See errors above")
        print("\nTroubleshooting:")
        print("  1. Make sure Celery workers are running:")
        print("     celery -A chess_analysis worker --loglevel=info")
        print("  2. Check Celery logs for errors")
        print("  3. Verify Redis is running (Celery message broker)")
    print("=" * 70)

    return success


if __name__ == "__main__":
    try:
        success = test_async_database_writethrough()
        sys.exit(0 if success else 1)
    except Exception as e:
        print(f"\n❌ FATAL ERROR: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)
