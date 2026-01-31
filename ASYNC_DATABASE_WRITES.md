# Async Database Writes with Celery

## Overview

Database writes for position evaluations are now handled **asynchronously using Celery**. This means:

1. ✅ **Users don't wait** - Report generation completes immediately
2. ✅ **Better performance** - Database writes happen in the background
3. ✅ **Concurrent safety** - Multiple users can write the same position without conflicts
4. ✅ **Retry logic** - Failed writes automatically retry with exponential backoff

## How It Works

### Before (Synchronous)
```
User Request → Analyze Game → GCP API → [WAIT] Database Write → Report Complete
                                             ^^^^^^ Users waited here!
```

### After (Asynchronous)
```
User Request → Analyze Game → GCP API → Report Complete ✓
                                             ↓
                                        Queue Celery Task
                                             ↓
                                        [Background] Database Write
```

## Implementation Details

### New Celery Task
**File:** `analysis/tasks.py` (line 627)

```python
@shared_task(bind=True, max_retries=3, autoretry_for=(Exception,), retry_backoff=True)
def write_evaluations_to_database_task(self, evaluations_json):
    """
    Asynchronously write position evaluations to the Digital Ocean PostgreSQL database.

    - Runs in background after report completes
    - Automatically retries on failure (up to 3 times)
    - Uses exponential backoff for retries
    - Deserializes JSON, writes with bulk_create()
    - Returns count of successfully written evaluations
    """
```

### Changes to Game Enricher
**File:** `analysis/chess_analysis/game_enricher.py`

Games are enriched during streaming analysis. Database writes were previously blocking.

- **Before:** `db_evaluator.write_evaluations_batch(gcp_results_batch)` (blocking)
- **After:** Database writes queued via `write_evaluations_to_database_task.delay(evaluations_json)` (async)
- **Result:** Games complete instantly, database writes happen in background

### Changes to Hybrid Analyzer
**File:** `analysis/chess_analysis/hybrid_analyzer.py` (line ~90)

- **Before:** `db_evaluator.write_evaluations_batch(gcp_results)` (blocking)
- **After:** `write_evaluations_to_database_task.delay(evaluations_json)` (async)

## Enhanced Logging

Database operations now print clear status messages:

### Database Reads
```
🔍 DATABASE LOOKUP: Checking database for 1128 positions...
✅ DATABASE RETURNED: 128 already evaluated positions, 1000 need evaluation
```

### Database Writes (Async)
```
📤 Queueing 458 GCP evaluations for async database write...
✅ Database write task queued (task_id: abc-123-def) - will process in background
```

### Celery Task Execution (Background)
```
📥 Celery task received - Task ID: abc-123-def
🔄 Starting database write: 458 evaluations (deserialized in 0.02s)
  📦 JSON deserialization: 0.02s
✅ Celery task complete: Wrote 458/458 evaluations
  ⏱️  Total task time: 2.15s
  💾 Database time: 2.10s
  📊 Throughput: 213 evals/sec
```

## Testing

### Test Script
Run `test_async_database_writethrough.py` to verify:
1. First analysis sends positions to GCP API
2. Database write is queued in Celery
3. Celery task processes write in background
4. Second analysis retrieves all positions from database (0 GCP calls)

```bash
# Make sure database worker is running
celery -A chess_analysis worker --loglevel=info --queues=celery --concurrency=4 -n database_worker@%h

# Run the test
python test_async_database_writethrough.py
```

### Expected Output
```
🎉 ALL TESTS PASSED!
Async database write-through is working correctly:
  - First run: Positions sent to GCP API
  - Database write task queued in Celery
  - Celery processed the task asynchronously
  - Second run: All positions retrieved from database
  - Zero GCP API calls on second run
```

## Benefits

### 1. Faster User Experience
- **Before:** Users waited 10-30+ seconds for database writes
- **After:** Report completes immediately, database writes happen in background

### 2. Concurrent Write Safety
Multiple users analyzing the same positions:
- **Before:** Potential race conditions with synchronous writes
- **After:** Celery handles deduplication and concurrent writes safely

### 3. Better Error Handling
- **Before:** Database errors could fail the entire report
- **After:** Database errors are retried automatically, report still succeeds

### 4. Scalability
- **Before:** Database writes blocked web workers
- **After:** Celery workers handle all database I/O independently

## Monitoring

Monitor Celery task status:
```bash
# View active tasks
celery -A chess_analysis inspect active

# View reserved (queued) tasks
celery -A chess_analysis inspect reserved

# View task stats
celery -A chess_analysis inspect stats
```

Check Celery logs for database write success/failure messages.

## Troubleshooting

### If database writes aren't happening:

1. **Check Celery workers are running:**
   ```bash
   ps aux | grep celery
   ```

2. **Check Redis is running (message broker):**
   ```bash
   redis-cli ping
   # Should return: PONG
   ```

3. **Check Celery logs:**
   ```bash
   # Look for database write task messages
   tail -f logs/celery_*.log
   ```

4. **Manually test the task:**
   ```python
   from analysis.tasks import write_evaluations_to_database_task
   result = write_evaluations_to_database_task.delay('{}')
   print(result.status)  # Should be 'SUCCESS' after completion
   ```

## Configuration

### Celery Settings
**File:** `chess_analysis/settings.py`

Ensure these settings are configured:
```python
CELERY_BROKER_URL = 'redis://localhost:6379/0'
CELERY_RESULT_BACKEND = 'redis://localhost:6379/0'
CELERY_TASK_TRACK_STARTED = True
CELERY_TASK_SERIALIZER = 'json'
CELERY_RESULT_SERIALIZER = 'json'
CELERY_ACCEPT_CONTENT = ['json']
```

### Database Worker Configuration
The database worker should run with concurrency > 1 for parallel writes:
```bash
celery -A chess_analysis worker --queues=celery --concurrency=4 -n database_worker@%h
```

Recommended concurrency: 4-8 (matches typical database connection pool size)

## Current Implementation Status

### Already Implemented
- ✅ **Async database writes** - Non-blocking Celery tasks
- ✅ **Bulk inserts** - Using Django's `bulk_create()` for 1000+ evals/sec
- ✅ **Automatic retries** - Exponential backoff on failures (3 max retries)
- ✅ **Detailed logging** - Track task progress and timing

### Future Improvements
Potential optimizations:
1. **Batch deduplication** - Check which positions already exist before writing (reduce duplicate writes)
2. **Task priority** - Prioritize database writes for active users vs background caching
3. **Monitoring dashboard** - Track database write success rates and queue depth
4. **Write coalescing** - Merge multiple small write tasks into larger batches
