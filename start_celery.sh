#!/bin/bash
# Start Celery workers for Chess.com and Lichess API tasks

echo "Starting Celery workers for both Chess.com and Lichess..."
echo "Make sure Redis is running: redis-server"
echo ""

# Start workers in background using &
# Use different worker names to distinguish them

echo "Starting Chess.com worker..."
celery -A chess_analysis worker \
    --loglevel=info \
    --queues=chess_com_api \
    --concurrency=1 \
    --max-tasks-per-child=100 \
    -n chess_com_worker@%h &

CHESS_COM_PID=$!

echo "Starting Lichess worker..."
celery -A chess_analysis worker \
    --loglevel=info \
    --queues=lichess_api \
    --concurrency=1 \
    --max-tasks-per-child=100 \
    -n lichess_worker@%h &

LICHESS_PID=$!

echo ""
echo "✓ Chess.com worker started (PID: $CHESS_COM_PID)"
echo "✓ Lichess worker started (PID: $LICHESS_PID)"
echo ""
echo "Press Ctrl+C to stop both workers"

# Wait for both background processes
wait

# Notes:
# - concurrency=1 ensures only one task runs at a time per platform
# - max-tasks-per-child=100 prevents memory leaks by recycling workers
# - Separate queues ensure platforms don't block each other
