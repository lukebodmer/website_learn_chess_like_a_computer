# GCP Stockfish API Architecture

## Overview

The Stockfish API is deployed on Google Cloud Platform (GCP) using Cloud Run, providing high-performance chess position evaluation as a containerized microservice. The API serves as the computational backend for chess analysis, accessible from both local development environments and the production Digital Ocean application.

## Architecture Components

### Cloud Run Service
- **Service Name**: `stockfish-api`
- **URL**: `https://stockfish-api-552342702662.us-west1.run.app`
- **Region**: `us-west1`
- **Container Image**: Stored in Artifact Registry (`us-west2-docker.pkg.dev/academic-arcade-483322-c8/stockfish-api-repo/stockfish-api:latest`)

### Resource Configuration
- **Memory**: 4Gi (handles large evaluation batches)
- **CPU**: 4 vCPU (parallel Stockfish processing)
- **Workers**: 8 Stockfish workers configured
- **Concurrency**: 1000 concurrent requests
- **Auto-scaling**: 0-10 instances based on demand
- **Timeout**: 300 seconds for deep evaluations

### Container Details
- **Base Image**: Python 3.11 slim
- **Stockfish Binary**: Ubuntu x86-64 AVX2 optimized version (SF 16)
- **Dependencies**: Flask 3.0.0, chess 1.11.2, gunicorn 21.2.0
- **Port**: 8080

## API Endpoints

### Health Check
```
GET /health
Response: {"service": "stockfish-api", "status": "healthy", "stockfish_path": "/usr/local/bin/stockfish", "workers": 8}
```

### Position Evaluation
```
POST /evaluate
Content-Type: application/json
Body: {
  "positions": ["fen1", "fen2", ...],
  "depth": 20
}
```

## Authentication & Security

### IAM Authentication Required
The service is deployed with `--no-allow-unauthenticated`, requiring Google Cloud IAM authentication for all requests.

### For Development/Testing
```bash
# Get identity token
export STOCKFISH_TOKEN=$(gcloud auth print-identity-token)

# Use in requests
curl -H "Authorization: Bearer $STOCKFISH_TOKEN" https://stockfish-api-552342702662.us-west1.run.app/health
```

### For Production (Digital Ocean App)
Requires service account authentication:
1. Create GCP service account
2. Grant Cloud Run Invoker role
3. Download service account JSON key
4. Use Google client libraries to obtain access tokens programmatically

## Request Flow

```
[Local Dev] ──┐
              ├──> [GCP Cloud Run] ──> [Stockfish Engine] ──> [Evaluation Results]
[DO App]   ──┘         │
                       └──> [Auto-scaling based on load]
```

1. **Client Request**: Local development or Digital Ocean app sends authenticated POST request
2. **Authentication**: GCP IAM validates bearer token
3. **Processing**: Cloud Run instance receives request, spawns Stockfish processes
4. **Evaluation**: Stockfish evaluates chess positions at specified depth
5. **Response**: JSON response with evaluations, timing metadata, and statistics
6. **Scaling**: Additional instances auto-spawn under high load (0-10 instances)

## Performance Characteristics

### Measured Performance
- **Single Position (depth 20)**: ~2.3 seconds
- **Evaluation Score**: Centipawn precision
- **Concurrent Processing**: 8 worker threads per instance
- **Auto-scaling**: Sub-minute cold start times

### Cost Structure
- **Pay-per-request**: Only charged during active evaluation
- **Memory**: 4Gi × usage time
- **CPU**: 4 vCPU × usage time
- **Network**: Ingress/egress data transfer

## Integration Points

### Local Development
- Uses developer's `gcloud` authentication
- Direct API calls during development/testing
- Same endpoints as production

### Digital Ocean Production App
- Service account-based authentication
- Batch position evaluation for game analysis
- Fallback to local Stockfish if GCP unavailable

## Monitoring & Observability

### Cloud Logging
```bash
gcloud logging read "resource.type=cloud_run_revision AND resource.labels.service_name=stockfish-api"
```

### Key Metrics
- Request latency per evaluation depth
- Success/failure rates
- Instance scaling patterns
- Cost per evaluation

## Repository Structure

### Build Configuration
- `Dockerfile`: Container image definition
- `cloudbuild.yaml`: GCP Cloud Build configuration
- `requirements_gcp.txt`: Python dependencies
- `stockfish_api.py`: Flask API implementation

### Artifact Registry
- **Repository**: `stockfish-api-repo`
- **Location**: `us-west2`
- **Image**: Tagged with `latest` for production deployments