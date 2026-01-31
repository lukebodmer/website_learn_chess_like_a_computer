#!/usr/bin/env python
"""
Script to clear all evaluation data from the Digital Ocean PostgreSQL database.
This clears the evaluations_pv, evaluations_data, and evaluations_position tables.
"""
import os
import sys
import django

# Setup Django
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'chess_analysis.settings')
django.setup()

from django.db import connections
from analysis.models import PositionEvaluation, EvaluationData, PrincipalVariation


def clear_evaluation_database():
    """Clear all rows from the evaluation database tables"""

    db_name = 'evaluations'

    print("Clearing evaluation database...")
    print("-" * 50)

    try:
        # Check counts before deletion
        with connections[db_name].cursor() as cursor:
            cursor.execute("SELECT COUNT(*) FROM evaluations_pv")
            pv_count = cursor.fetchone()[0]

            cursor.execute("SELECT COUNT(*) FROM evaluations_data")
            data_count = cursor.fetchone()[0]

            cursor.execute("SELECT COUNT(*) FROM evaluations_position")
            position_count = cursor.fetchone()[0]

        print(f"Current row counts:")
        print(f"  - Principal Variations: {pv_count}")
        print(f"  - Evaluation Data: {data_count}")
        print(f"  - Positions: {position_count}")
        print()

        if position_count == 0:
            print("Database is already empty. Nothing to clear.")
            return

        # Delete using Django ORM (respects foreign key cascade)
        print("Deleting all evaluations...")

        # Delete PrincipalVariation records first
        pv_deleted = PrincipalVariation.objects.using(db_name).all().delete()
        print(f"  ✓ Deleted {pv_deleted[0]} principal variation records")

        # Delete EvaluationData records
        data_deleted = EvaluationData.objects.using(db_name).all().delete()
        print(f"  ✓ Deleted {data_deleted[0]} evaluation data records")

        # Delete PositionEvaluation records
        pos_deleted = PositionEvaluation.objects.using(db_name).all().delete()
        print(f"  ✓ Deleted {pos_deleted[0]} position records")

        print()
        print("=" * 50)
        print("✓ Evaluation database cleared successfully!")
        print("=" * 50)

    except Exception as e:
        print(f"✗ Error clearing database: {e}")
        sys.exit(1)


if __name__ == "__main__":
    clear_evaluation_database()
