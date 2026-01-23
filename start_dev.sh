#!/usr/bin/env bash
# Start all services for development (Redis, Celery workers, Django)

echo "🚀 Starting all services..."
echo ""

# Function to cleanup on exit
cleanup() {
    echo ""
    echo "🛑 Shutting down all services..."
    kill $(jobs -p) 2>/dev/null
    exit
}

trap cleanup SIGINT SIGTERM

# Start Redis
echo "Starting Redis..."
redis-server --daemonize yes --port 6379

# Wait for Redis to be ready
sleep 1

# Start Chess.com Celery worker (log to file)
echo "Starting Chess.com worker..."
celery -A chess_analysis worker \
    --loglevel=info \
    --queues=chess_com_api \
    --concurrency=1 \
    --pool=threads \
    -n chess_com_worker@%h \
    --logfile=logs/celery_chess_com.log &

# Start Lichess Celery worker (log to file)
echo "Starting Lichess worker..."
celery -A chess_analysis worker \
    --loglevel=info \
    --queues=lichess_api \
    --concurrency=1 \
    --pool=threads \
    -n lichess_worker@%h \
    --logfile=logs/celery_lichess.log &

# Wait for workers to start
sleep 2

# Start Django development server
echo "Starting Django server..."
echo ""
echo "✓ All services running!"
echo "  - Redis: localhost:6379"
echo "  - Chess.com worker: Active"
echo "  - Lichess worker: Active"
echo "  - Django: http://127.0.0.1:8000"
echo ""
echo "Press Ctrl+C to stop all services"
echo ""

python manage.py runserver

# Cleanup will be called on Ctrl+C
