# Celery Setup for API Rate Limiting and Database Writes

This document explains how to run the Celery-based background task system for:
1. **Chess.com and Lichess API rate limiting** (serial access enforcement)
2. **Async database writes** to Digital Ocean PostgreSQL (non-blocking position evaluations)

## What Was Changed

### Architecture Improvements

#### API Rate Limiting (Chess.com & Lichess)
1. **Background Task Processing**: Game fetching runs in Celery background tasks instead of blocking HTTP requests
2. **Serial Access Enforcement**: Redis-based locks ensure only ONE API request is active at a time per platform
3. **Separate Queues**: Chess.com and Lichess use separate queues to prevent one platform from blocking the other
4. **Task Queuing**: Multiple users requesting reports will be queued and processed sequentially per platform
5. **Progress Tracking**: Frontend polls for task status and shows real-time progress
6. **429 Handling**: Automatic 60-second cooldown if rate limit is hit

#### Async Database Writes (Position Evaluations)
1. **Non-Blocking Writes**: New Stockfish evaluations are written to Digital Ocean PostgreSQL via Celery tasks
2. **Immediate Report Completion**: Users don't wait for database writes (queued in background)
3. **Automatic Retries**: Failed writes retry with exponential backoff (3 max retries)
4. **Shared Queue**: Database writes use the default Celery queue alongside other background tasks
5. **Write-Through Cache**: GCP Stockfish results are cached asynchronously after report generation

### Files Modified/Created

#### Celery Infrastructure
- `chess_analysis/celery.py` - Celery app configuration
- `chess_analysis/__init__.py` - Auto-import Celery app
- `chess_analysis/settings.py` - Celery and Redis settings
- `flake.nix` - Added Celery, Redis, and django-celery-results packages

#### API Rate Limiting Tasks
- `analysis/tasks.py` - Background tasks for Chess.com/Lichess fetching + database writes
- `analysis/views.py` - Updated to dispatch Celery tasks and poll for status
- `analysis/urls.py` - Added task status polling endpoint
- `src/components/generate-report.tsx` - Frontend polling implementation

#### Async Database Write Tasks
- `analysis/tasks.py:write_evaluations_to_database_task()` - Async database write task (lines 632-680)
- `analysis/chess_analysis/hybrid_analyzer.py` - Queues database writes after GCP analysis (lines 90-106)
- `analysis/chess_analysis/game_enricher.py` - Queues database writes during streaming (lines 754-772)

## Setup Instructions

### Quick Start (Recommended)

Use the provided scripts to start/stop all services automatically:

```bash
# Start all services (Redis, Celery workers, Django)
./start_dev.sh

# Stop all services
./stop_dev.sh
```

This starts:
- **Redis**: Message broker (port 6379)
- **Database Worker**: Handles evaluation writes (concurrency=2, queue=celery)
- **Chess.com Worker**: Handles Chess.com API (concurrency=1, queue=chess_com_api)
- **Lichess Worker**: Handles Lichess API (concurrency=1, queue=lichess_api)
- **Django Server**: Web app (http://127.0.0.1:8000)

Worker logs are written to:
- `logs/celery_database.log`
- `logs/celery_chess_com.log`
- `logs/celery_lichess.log`

### Manual Setup (Advanced)

If you need to run services manually:

**1. Update Nix Environment** (if not already done):
```bash
# Exit and re-enter Nix shell to install: celery, redis, django-celery-results
```

**2. Run Database Migrations** (one-time setup):
```bash
python manage.py migrate django_celery_results
```

**3. Start Redis**:
```bash
redis-server --daemonize yes --port 6379
```

**4. Start Celery Workers** (in separate terminals or as daemons):

Database worker (concurrency=2):
```bash
celery -A chess_analysis worker --loglevel=info --queues=celery --concurrency=2 --pool=threads -n database_worker@%h
```

Chess.com worker (concurrency=1):
```bash
celery -A chess_analysis worker --loglevel=info --queues=chess_com_api --concurrency=1 --pool=threads -n chess_com_worker@%h
```

Lichess worker (concurrency=1):
```bash
celery -A chess_analysis worker --loglevel=info --queues=lichess_api --concurrency=1 --pool=threads -n lichess_worker@%h
```

**5. Start Django**:
```bash
python manage.py runserver
```

## How It Works

### API Request Flow (Chess.com / Lichess)

1. **User initiates report generation**
   - Frontend makes request to `/chess-com/fetch-games/{username}/` or `/lichess/fetch-games/{username}/`
   - Django immediately returns with `task_id` (non-blocking)

2. **Task is queued**
   - Celery receives task and adds it to platform-specific queue (`chess_com_api` or `lichess_api`)
   - Task waits if rate limit is reached

3. **Worker processes task**
   - Worker acquires Redis lock for serial access
   - Fetches games from API (one request at a time)
   - Updates task progress in real-time

4. **Frontend polls for status**
   - Every 2 seconds, frontend polls `/chess-com/task-status/{task_id}/` or `/lichess/task-status/{task_id}/`
   - Shows progress bar and status messages
   - Redirects to report when complete

### Database Write Flow (Position Evaluations)

1. **GCP Stockfish analysis completes**
   - Game analysis finishes, new position evaluations obtained
   - Report is immediately available to user (no waiting)

2. **Database write task is queued**
   - New evaluations serialized to JSON
   - `write_evaluations_to_database_task.delay(evaluations_json)` queued
   - Task added to default `celery` queue

3. **Database worker processes task**
   - Worker deserializes evaluations
   - Writes to Digital Ocean PostgreSQL using bulk insert
   - Automatically retries on failure (up to 3 times with exponential backoff)

4. **Task completes in background**
   - Evaluations now cached in database
   - Next analysis of same positions will be instant (database hit)

### Rate Limiting Strategy

**Chess.com and Lichess Official Rate Limit Policy**:

Both platforms have identical policies:
> "Serial access is unlimited/allowed. Parallel requests may trigger rate limiting, resulting in a '429 Too Many Requests' response. The key rules to follow are to limit requests to one at a time sequentially and to wait a full minute if you receive a 429 Too Many Requests status code."

**Our Implementation**:

1. **Separate Redis Locks for Each Platform**:
   - **Chess.com**: Only ONE Chess.com API request can be active at ANY time across ALL workers
   - **Lichess**: Only ONE Lichess API request can be active at ANY time across ALL workers
   - Uses Redis `SET NX` (atomic set-if-not-exists) for distributed locking
   - Lock timeouts: 10s for Chess.com, 30s for Lichess (streaming can be slower)
   - **Result**: Serial access per platform = UNLIMITED throughput ✨

2. **429 Response Handling Per Platform**:
   - If 429 received, mark in Redis with 60-second TTL (separate keys per platform)
   - All workers for that platform wait 60 seconds before making new requests
   - Task automatically retries after wait period
   - Other platform unaffected

3. **Separate Task Queues**:
   - **chess_com_api** queue: Handles Chess.com requests
   - **lichess_api** queue: Handles Lichess requests
   - Prevents one platform from blocking the other
   - Both can process simultaneously (one Chess.com + one Lichess at the same time)

4. **No Artificial Rate Limits**:
   - No per-minute request limits
   - No progressive delays between requests
   - No Celery task rate limiting
   - **Serial access is as fast as the API responds**

### Scaling for 10,000 Calls/Month

With serial access being unlimited:
- **Throughput**: Limited only by Chess.com's API response time (~100-500ms per request)
- **Estimated capacity**: 120-600 requests/minute = 7,200-36,000 requests/hour
- **Your target**: 10,000 requests/month = ~333 requests/day = ~14 requests/hour
- **Result**: You have 500-2,500x headroom! 🚀

The Redis lock ensures we never trigger parallel request limits while maximizing throughput.

## Monitoring

### Check Celery Worker Status
```bash
# View all active tasks across all workers
celery -A chess_analysis inspect active

# View active tasks for specific worker (use hostname, not localhost)
celery -A chess_analysis inspect active --destination=database_worker@$(hostname)
```

### Check Redis Connection
```bash
redis-cli ping
# Should return: PONG
```

### View Task Queues
```bash
# View all reserved (queued) tasks
celery -A chess_analysis inspect reserved

# View scheduled tasks
celery -A chess_analysis inspect scheduled

# View registered tasks
celery -A chess_analysis inspect registered
```

### Monitor Serial Access Locks in Redis
```bash
redis-cli

# Chess.com locks
> GET chess_com_api_lock
# Shows "1" if a Chess.com request is currently active, empty if available
> GET chess_com_api_429_received
# Shows "1" if Chess.com 429 received and in 60-second cooldown

# Lichess locks
> GET lichess_api_lock
# Shows "1" if a Lichess request is currently active, empty if available
> GET lichess_api_429_received
# Shows "1" if Lichess 429 received and in 60-second cooldown
```

### Monitor Database Write Tasks
```bash
# View Celery logs for database writes
tail -f logs/celery_database.log

# Check for database write task messages:
# "📥 Celery task received - Task ID: abc-123"
# "✅ Celery task complete: Wrote 458/458 evaluations"
```

## Troubleshooting

### "Connection refused" error
- Make sure Redis is running: `redis-server`
- Check Redis is listening on localhost:6379

### Tasks not processing
- Make sure all Celery workers are running (Chess.com, Lichess, Database)
- Check worker logs for errors: `tail -f logs/celery_*.log`
- Verify workers are registered: `celery -A chess_analysis inspect active`

### Database writes not happening
- Check database worker is running: `ps aux | grep "database_worker"`
- Check task was queued: Look for "Database write task queued" in application logs
- Verify Digital Ocean database credentials in `.env` file
- Test database connection: `python test_digitalocean_write_performance.py`
- Check Celery logs: `tail -f logs/celery_database.log`

### Rate limit (429) still being hit
- This shouldn't happen if Redis is working correctly
- Check Redis lock is functioning: `redis-cli GET chess_com_api_lock`
- Verify only one worker is making requests at a time
- If persistent, the 60-second cooldown should resolve it
- Consider increasing `LOCK_TIMEOUT` in `analysis/tasks.py` if requests are slow

### Task stuck in PENDING
- Worker may have crashed - restart the appropriate worker
- Check task exists: `celery -A chess_analysis inspect scheduled`
- Check task result backend: `celery -A chess_analysis inspect stats`

### Database writes failing silently
- Check for retry attempts: `celery -A chess_analysis events` (shows retries)
- Look for errors in logs: `grep "❌" logs/celery_database.log`
- Manually test task: `python -c "from analysis.tasks import write_evaluations_to_database_task; write_evaluations_to_database_task.delay('{}')"`

## Production Deployment

For production, consider:

1. **Use Supervisor or systemd** to keep Redis and all Celery workers running
   - See `start_dev.sh` for reference worker configurations
2. **Monitor with Flower**: `celery -A chess_analysis flower`
3. **Use RabbitMQ** instead of Redis for better message guarantees
4. **Add task time limits** (already configured: 30 minutes max per task)
5. **Set up logging** to track rate limit hits and database write failures
   - Logs already configured in `start_dev.sh` → `logs/celery_*.log`
6. **Scale workers** based on traffic:
   - Keep concurrency=1 for Chess.com/Lichess workers (serial access required)
   - Database worker: Currently concurrency=2, can increase to 4-8 for high traffic
   - Use `--pool=threads` for I/O-bound tasks (already configured)
7. **Database connection pooling** - Ensure Django's `CONN_MAX_AGE` is set for reusing connections
8. **Monitor database write success rate** - Track failed vs successful writes via logs
9. **Redis persistence** - Enable AOF or RDB for task recovery after crashes

## Testing

### Test API Rate Limiting
```bash
# 1. Start all services (Redis, 3 Celery workers, Django)

# 2. Connect Chess.com or Lichess account in your app

# 3. Generate a report - you should see:
#    - Immediate response with task_id
#    - Progress updates in frontend
#    - Worker logs showing API calls with serial access
#    - Successful completion

# 4. Try multiple simultaneous requests to test queuing
```

### Test Async Database Writes
```bash
# 1. Ensure all services are running
./start_dev.sh

# 2. Generate a report with new positions:
#    - Go to http://127.0.0.1:8000
#    - Connect Chess.com or Lichess account
#    - Generate a report
#    - Wait for completion

# 3. Check logs for database write task:
tail -f logs/celery_database.log

# Expected log messages:
# "📝 Queueing X GCP evaluations for async database write..."
# "✅ Database write task queued: <task_id>"
# "💾 DATABASE WRITE: Writing X position evaluations to database..."
# "✅ ASYNC DATABASE WRITE: X evaluations written"

# 4. Verify cache is working:
#    - Generate another report for the same user
#    - Should see more database hits, fewer GCP calls
#    - Check logs: "✅ DATABASE RETURNED: X already evaluated positions..."
```
