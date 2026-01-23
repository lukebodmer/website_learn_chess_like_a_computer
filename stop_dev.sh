#!/usr/bin/env bash
# Stop all development services

echo "🛑 Stopping all services..."

# Stop Redis
redis-cli shutdown 2>/dev/null && echo "✓ Redis stopped" || echo "✗ Redis not running"

# Stop Celery workers
pkill -f "celery.*chess_com_worker" && echo "✓ Chess.com worker stopped" || echo "✗ Chess.com worker not running"
pkill -f "celery.*lichess_worker" && echo "✓ Lichess worker stopped" || echo "✗ Lichess worker not running"

# Stop Django (if running in background)
pkill -f "manage.py runserver" && echo "✓ Django stopped" || echo "✗ Django not running"

echo ""
echo "All services stopped."
