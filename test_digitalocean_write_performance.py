#!/usr/bin/env python
"""
Test write performance to Digital Ocean PostgreSQL database
Measures actual latency and throughput to remote database
"""
import os
import sys
import django
import time

# Setup Django
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'chess_analysis.settings')
django.setup()

from analysis.chess_analysis.database_evaluator import DatabaseEvaluator
from django.db import connections


def test_connection_latency():
    """Test basic connection latency to Digital Ocean"""
    print("🔍 Testing connection to Digital Ocean PostgreSQL...")

    db_name = 'evaluations'

    # Test 1: Simple ping query
    start = time.time()
    with connections[db_name].cursor() as cursor:
        cursor.execute("SELECT 1")
        cursor.fetchone()
    ping_time = (time.time() - start) * 1000

    print(f"  ✓ Ping latency: {ping_time:.1f}ms")

    # Test 2: Count query
    start = time.time()
    with connections[db_name].cursor() as cursor:
        cursor.execute("SELECT COUNT(*) FROM evaluations_position")
        count = cursor.fetchone()[0]
    count_time = (time.time() - start) * 1000

    print(f"  ✓ Count query: {count_time:.1f}ms ({count} positions)")

    return ping_time


def test_bulk_write_performance():
    """Test bulk write performance with different batch sizes"""

    db = DatabaseEvaluator()

    test_sizes = [10, 50, 100, 500, 1000, 1200]

    print("\n📊 Testing bulk write performance:")
    print(f"{'Count':<8} {'Time':<12} {'Rate':<20} {'Per Eval'}")
    print("-" * 60)

    for size in test_sizes:
        # Generate test data
        test_evals = {}
        for i in range(size):
            # Use unique FENs to avoid conflicts
            fen = f'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 {int(time.time() * 1000) + i}'
            test_evals[fen] = {
                'evaluation': i % 100,
                'depth': 20,
                'knodes': 50000,
                'variation': 'e7e5 Ng1f3 Nb8c6'
            }

        # Measure write time
        start = time.time()
        written = db.write_evaluations_batch(test_evals)
        elapsed = time.time() - start

        rate = written / elapsed if elapsed > 0 else 0
        per_eval = (elapsed / written * 1000) if written > 0 else 0

        print(f"{written:<8} {elapsed:>6.2f}s      {rate:>8.0f} evals/sec   {per_eval:>6.1f}ms")

        # Small delay between tests
        time.sleep(0.5)

    print()


def analyze_bottleneck():
    """Identify where the time is being spent"""
    print("🔬 Analyzing bottleneck breakdown for 1000 evaluations...")

    db = DatabaseEvaluator()

    # Generate test data
    test_evals = {}
    for i in range(1000):
        fen = f'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 {int(time.time() * 1000) + i}'
        test_evals[fen] = {
            'evaluation': i % 100,
            'depth': 20,
            'knodes': 50000,
            'variation': 'e7e5 Ng1f3 Nb8c6'
        }

    from analysis.models import PositionEvaluation, EvaluationData, PrincipalVariation
    from django.db import transaction

    db_name = 'evaluations'

    # Step 1: Prepare data
    start = time.time()
    positions_to_create = []
    fen_to_truncated = {}

    for fen in test_evals.keys():
        truncated_fen = db.truncate_fen(fen)
        fen_to_truncated[fen] = truncated_fen
        positions_to_create.append(PositionEvaluation(fen=truncated_fen))

    prep_time = time.time() - start
    print(f"  Data preparation: {prep_time*1000:.1f}ms")

    # Step 2: Bulk insert positions
    start = time.time()
    with transaction.atomic(using=db_name):
        PositionEvaluation.objects.using(db_name).bulk_create(
            positions_to_create,
            ignore_conflicts=True
        )
    positions_time = time.time() - start
    print(f"  Bulk create positions: {positions_time*1000:.1f}ms")

    # Step 3: Fetch positions
    start = time.time()
    truncated_fens = list(fen_to_truncated.values())
    position_lookup = {
        pos.fen: pos
        for pos in PositionEvaluation.objects.using(db_name).filter(
            fen__in=truncated_fens
        )
    }
    fetch_time = time.time() - start
    print(f"  Fetch positions: {fetch_time*1000:.1f}ms")

    # Step 4: Prepare eval data
    start = time.time()
    eval_data_to_create = []
    eval_data_map = {}

    for idx, (fen, eval_data) in enumerate(test_evals.items()):
        truncated_fen = fen_to_truncated[fen]
        position = position_lookup.get(truncated_fen)

        if not position:
            continue

        knodes = eval_data.get('knodes', 0)
        if isinstance(knodes, float):
            knodes = int(knodes * 1000)
        else:
            knodes = int(knodes)

        depth = eval_data.get('depth', 20)

        eval_data_obj = EvaluationData(
            position=position,
            knodes=knodes,
            depth=depth,
            pv_count=1
        )
        eval_data_to_create.append(eval_data_obj)
        eval_data_map[idx] = (eval_data_obj, eval_data)

    prep_eval_time = time.time() - start
    print(f"  Prepare eval data: {prep_eval_time*1000:.1f}ms")

    # Step 5: Bulk insert eval data
    start = time.time()
    with transaction.atomic(using=db_name):
        EvaluationData.objects.using(db_name).bulk_create(eval_data_to_create)
    eval_insert_time = time.time() - start
    print(f"  Bulk create eval data: {eval_insert_time*1000:.1f}ms")

    # Step 6: Prepare PVs
    start = time.time()
    pv_to_create = []

    for eval_data_obj, source_data in eval_data_map.values():
        cp_score = source_data.get('evaluation')
        mate_score = source_data.get('mate')

        pv_to_create.append(
            PrincipalVariation(
                evaluation=eval_data_obj,
                pv_index=0,
                cp=cp_score if mate_score is None else None,
                mate=mate_score,
                line=source_data.get('variation', '')
            )
        )

    prep_pv_time = time.time() - start
    print(f"  Prepare PVs: {prep_pv_time*1000:.1f}ms")

    # Step 7: Bulk insert PVs
    start = time.time()
    with transaction.atomic(using=db_name):
        PrincipalVariation.objects.using(db_name).bulk_create(pv_to_create)
    pv_insert_time = time.time() - start
    print(f"  Bulk create PVs: {pv_insert_time*1000:.1f}ms")

    total = prep_time + positions_time + fetch_time + prep_eval_time + eval_insert_time + prep_pv_time + pv_insert_time
    print(f"\n  TOTAL: {total*1000:.1f}ms ({total:.2f}s)")
    print(f"\n  Network I/O (inserts + fetches): {(positions_time + fetch_time + eval_insert_time + pv_insert_time)*1000:.1f}ms")
    print(f"  Local processing: {(prep_time + prep_eval_time + prep_pv_time)*1000:.1f}ms")


if __name__ == "__main__":
    print("=" * 70)
    print("  DIGITAL OCEAN DATABASE PERFORMANCE TEST")
    print("=" * 70)
    print()

    try:
        # Test connection
        ping_latency = test_connection_latency()

        # Test bulk writes
        test_bulk_write_performance()

        # Analyze bottleneck
        analyze_bottleneck()

        print("=" * 70)
        print("✅ Performance test complete!")
        print("=" * 70)

    except Exception as e:
        print(f"\n❌ Error: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)
