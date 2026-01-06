# GCP Stockfish API

High-performance chess position evaluation API deployed on Google Cloud Platform.

## Quick Deploy

```bash
cd gcp-stockfish-api
./deploy.sh
```

## Manual Commands

### Build and Push
```bash
gcloud builds submit --region=us-west2 --config cloudbuild.yaml
```

### Deploy to Cloud Run
```bash
gcloud run deploy stockfish-api \
  --image us-west2-docker.pkg.dev/$PROJECT_ID/stockfish-api-repo/stockfish-api:latest \
  --region us-west1 \
  --memory 4Gi \
  --cpu 4 \
  --max-instances 10 \
  --concurrency 1000 \
  --timeout 300s \
  --no-allow-unauthenticated
```

## Testing

```bash
# Get auth token
export STOCKFISH_TOKEN=$(gcloud auth print-identity-token)

# Health check
curl -H "Authorization: Bearer $STOCKFISH_TOKEN" https://your-service-url/health

# Position evaluation
curl -X POST https://your-service-url/evaluate \
  -H "Authorization: Bearer $STOCKFISH_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "positions": ["rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3"],
    "depth": 20
  }'
```

## Files

- `stockfish_api.py` - Flask API server
- `requirements_gcp.txt` - Python dependencies
- `Dockerfile` - Container configuration
- `cloudbuild.yaml` - GCP build configuration
- `deploy.sh` - Automated deployment script