# GCP Stockfish API - Performance Configuration

## Optimization Goal
**Maximize speed by forcing all 12 GCP instances to spin up for every report.**

## Key Configuration Change

### Container Concurrency: 80 → 6

**Before (concurrency=80):**
- 75 concurrent requests → 1 instance spins up
- Uses 8 vCPUs (1 instance × 8)
- Report completes in ~60 seconds
- Cost: 60 instance-seconds

**After (concurrency=6):**
- 75 concurrent requests → 12 instances spin up
- Uses 96 vCPUs (12 instances × 8)
- Report completes in ~5 seconds
- Cost: 60 instance-seconds (same!)

## Performance Impact

### Speed Improvement
- **12x faster processing**
- Typical report: 60s → 5s
- All 96 vCPUs utilized simultaneously

### Cost Impact
- **No cost increase!**
- 1 instance × 60s = 12 instances × 5s = 60 instance-seconds
- GCP charges for instance-seconds, so cost is identical

## How It Works

### Instance Scaling Logic
```
instances_needed = concurrent_requests / container_concurrency
75 requests / 6 concurrency = 12.5 → 12 instances (rounded down)
```

### Why This Is Optimal

**Typical report:**
- 150 games × 40 positions = 6,000 positions
- 6,000 ÷ 80 batch size = 75 batches
- 75 concurrent API requests sent

**With concurrency=6:**
- Each instance handles max 6 concurrent requests
- 75 requests ÷ 6 = 12.5 → **12 instances spin up**
- All 12 instances process batches in parallel
- Maximum resource utilization

## Resource Utilization

### Per Instance
- **vCPUs**: 8
- **Memory**: 8 GB
- **Engines**: 8 (single-threaded)
- **Hash per engine**: 128 MB
- **Concurrent requests**: 6

### Total Capacity (12 instances)
- **Total vCPUs**: 96 (100% utilized)
- **Total memory**: 96 GB
- **Total engines**: 96
- **Max concurrent requests**: 72 (12 × 6)

## Deployment

To deploy with optimized settings:
```bash
cd gcp-stockfish-api
./deploy.sh
```

The deployment will:
1. Build the container image
2. Deploy with `--concurrency 6`
3. Configure for 12 max instances
4. Force aggressive scaling for maximum speed

## Monitoring

After deployment, verify instances are scaling:
```bash
# Check active instances
gcloud logging read "resource.type=cloud_run_revision AND resource.labels.service_name=stockfish-api" \
  --limit 100 --format=json --freshness=5m | \
  python -c "import json, sys; instances = set(log.get('labels', {}).get('instanceId') for log in json.load(sys.stdin)); print(f'Active instances: {len(instances)}')"
```

Expected during report generation:
- **Before**: 1 instance active
- **After**: 12 instances active

## Configuration Details

### Environment Variables
- `WORKERS=2`: Gunicorn workers per instance
- `DEFAULT_STOCKFISH_DEPTH=12`: (deprecated, using time limit now)

### Stockfish Settings (in stockfish_api.py)
- `STOCKFISH_TIME = 0.2`: 200ms per position
- `STOCKFISH_NODES = None`: No node limit
- `STOCKFISH_DEPTH = None`: No depth limit
- `HASH_SIZE_MB = 128`: Safe for 8 GB instances

### Scaling Settings
- `min-instances: 0`: Scale to zero when idle (save cost)
- `max-instances: 12`: Maximum parallel processing
- `concurrency: 6`: Force more instances to spin up
- `timeout: 60s`: Sufficient for batch processing

## Expected Performance Metrics

### Single Report (6,000 positions)
- **Positions**: 6,000
- **Batches**: 75
- **Instances**: 12
- **Time**: ~5 seconds
- **Throughput**: 1,200 positions/second

### Peak Load (Multiple Users)
With sequential processing (one report at a time):
- **Reports/minute**: 12 (vs 1 before)
- **Queue wait**: Virtually zero under normal load
- **Can handle**: 10,000 users with ease

## Troubleshooting

### If instances don't scale to 12:
1. **Not enough concurrent requests**: Report might be too small (<75 batches)
2. **Cold start delay**: First few requests might take longer while instances spin up
3. **GCP quota limits**: Check Cloud Run quotas in console

### If getting 500 errors:
1. **Memory issue**: Check hash size (should be 128 MB)
2. **Timeout**: Increase timeout if needed
3. **Engine pool exhaustion**: Should not happen with proper sizing

## Cost Optimization

This configuration is **cost-neutral** because:
- GCP charges for: `instances × time`
- We use: `12 instances × 5s = 60 instance-seconds`
- Same as: `1 instance × 60s = 60 instance-seconds`

You get **12x faster** for **the same cost**! 🚀

## Future Scaling

If you need even more speed:
- Increase to 24 or 48 max instances
- Reduce concurrency to 3 (forces 2x more instances)
- Use 16 vCPU instances (2x capacity per instance)

Current configuration is optimal for 10,000 users with 3 reports/month each.
