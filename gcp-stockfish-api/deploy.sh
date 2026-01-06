#!/usr/bin/env bash
# GCP Stockfish API Deployment Script

set -e

# Configuration
PROJECT_ID="academic-arcade-483322-c8"
REGION="us-west1"
REPOSITORY_REGION="us-west2"
SERVICE_NAME="stockfish-api"
REPOSITORY_NAME="stockfish-api-repo"

echo "🚀 Deploying Stockfish API to GCP..."

# Build and push the container image
echo "📦 Building container image..."
gcloud builds submit --project=$PROJECT_ID --region=$REPOSITORY_REGION --config cloudbuild.yaml

# Deploy to Cloud Run
echo "🌊 Deploying to Cloud Run..."
gcloud run deploy $SERVICE_NAME \
  --image $REPOSITORY_REGION-docker.pkg.dev/$PROJECT_ID/$REPOSITORY_NAME/$SERVICE_NAME:latest \
  --platform managed \
  --region $REGION \
  --project=$PROJECT_ID \
  --memory 8Gi \
  --cpu 4 \
  --min-instances 1 \
  --max-instances 5 \
  --concurrency 10 \
  --timeout 120s \
  --set-env-vars DEFAULT_STOCKFISH_DEPTH=24 \
  --no-allow-unauthenticated

# Get the service URL
echo "🔗 Getting service URL..."
SERVICE_URL=$(gcloud run services describe $SERVICE_NAME --region $REGION --project=$PROJECT_ID --format="value(status.url)")

echo "✅ Deployment complete!"
echo "🔗 Service URL: $SERVICE_URL"
echo "🔑 Test with authentication token:"
echo "   export STOCKFISH_TOKEN=\$(gcloud auth print-identity-token)"
echo "   curl -H \"Authorization: Bearer \$STOCKFISH_TOKEN\" $SERVICE_URL/health"
