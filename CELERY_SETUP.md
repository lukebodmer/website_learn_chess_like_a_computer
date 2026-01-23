# Celery Setup for Chess.com and Lichess API Rate Limiting

This document explains how to run the Celery-based background task system for Chess.com and Lichess game fetching with global rate limiting.

## What Was Changed

### Architecture Improvements
1. **Background Task Processing**: Both Chess.com and Lichess game fetching now run in Celery background tasks instead of blocking HTTP requests
2. **Serial Access Enforcement**: Redis-based locks ensure only ONE API request is active at a time per platform
3. **Separate Queues**: Chess.com and Lichess use separate queues to prevent one platform from blocking the other
4. **Task Queuing**: Multiple users requesting reports will be queued and processed sequentially per platform
5. **Progress Tracking**: Frontend polls for task status and shows real-time progress
6. **429 Handling**: Automatic 60-second cooldown if rate limit is hit

### Files Modified/Created
- `chess_analysis/celery.py` - Celery app configuration
- `chess_analysis/__init__.py` - Auto-import Celery app
- `chess_analysis/settings.py` - Celery and Redis settings
- `analysis/tasks.py` - Background task for fetching Chess.com games
- `analysis/views.py` - Updated to dispatch Celery tasks and poll for status
- `analysis/urls.py` - Added task status polling endpoint
- `src/components/generate-report.tsx` - Frontend polling implementation
- `flake.nix` - Added Celery, Redis, and django-celery-results packages
- `start_celery.sh` - Script to start Celery worker

## Setup Instructions

### 1. Update Nix Environment

Exit and re-enter your Nix shell to install new packages:

```bash
# Exit current shell
exit

# Re-enter to rebuild with new packages
# This will install: celery, redis, django-celery-results, and redis-server
```

### 2. Run Database Migrations

Create tables for Celery result backend:

```bash
python manage.py migrate django_celery_results
```

### 3. Start Redis Server

In a **new terminal**, start Redis:

```bash
redis-server
```

Keep this running. Redis is the message broker and result backend for Celery.

### 4. Start Celery Workers

You need to start **TWO** Celery workers (one for each platform):

**Terminal 2 - Chess.com worker**:
```bash
celery -A chess_analysis worker --loglevel=info --queues=chess_com_api --concurrency=1 -n chess_com_worker@%h
```

**Terminal 3 - Lichess worker**:
```bash
celery -A chess_analysis worker --loglevel=info --queues=lichess_api --concurrency=1 -n lichess_worker@%h
```

Keep both running. Each worker processes background tasks for its respective platform.

### 5. Start Django Development Server

In your **original terminal**, start Django as usual:

```bash
python manage.py runserver
```

## How It Works

### Request Flow

1. **User initiates Chess.com report generation**
   - Frontend makes request to `/chess-com/fetch-games/{username}/`
   - Django immediately returns with `task_id` (non-blocking)

2. **Task is queued**
   - Celery receives task and adds it to `chess_com_api` queue
   - Task waits if rate limit is reached

3. **Worker processes task**
   - Worker checks global rate limit (50 req/min via Redis)
   - Fetches games with progressive delays between requests
   - Updates task progress in real-time

4. **Frontend polls for status**
   - Every 2 seconds, frontend polls `/chess-com/task-status/{task_id}/`
   - Shows progress bar and status messages
   - Redirects to report when complete

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
celery -A chess_analysis inspect active
```

### Check Redis Connection
```bash
redis-cli ping
# Should return: PONG
```

### View Task Queue
```bash
celery -A chess_analysis inspect reserved
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

## Troubleshooting

### "Connection refused" error
- Make sure Redis is running: `redis-server`
- Check Redis is listening on localhost:6379

### Tasks not processing
- Make sure Celery worker is running: `./start_celery.sh`
- Check worker logs for errors

### Rate limit (429) still being hit
- This shouldn't happen if Redis is working correctly
- Check Redis lock is functioning: `redis-cli GET chess_com_api_lock`
- Verify only one worker is making requests at a time
- If persistent, the 60-second cooldown should resolve it
- Consider increasing `LOCK_TIMEOUT` in `analysis/tasks.py` if requests are slow

### Task stuck in PENDING
- Worker may have crashed - restart with `./start_celery.sh`
- Check task exists: `celery -A chess_analysis inspect scheduled`

## Production Deployment

For production, consider:

1. **Use Supervisor or systemd** to keep Redis and Celery running
2. **Monitor with Flower**: `celery -A chess_analysis flower`
3. **Use RabbitMQ** instead of Redis for better message guarantees
4. **Add task time limits** (already configured: 30 minutes)
5. **Set up logging** to track rate limit hits
6. **Scale workers** based on traffic (but keep concurrency=1 per worker)

## Testing

Test the setup:

```bash
# 1. Start all services (Redis, Celery worker, Django)

# 2. Connect Chess.com account in your app

# 3. Generate a report - you should see:
#    - Immediate response with task_id
#    - Progress updates in frontend
#    - Worker logs showing API calls
#    - Successful completion

# 4. Try multiple simultaneous requests to test queuing
```
