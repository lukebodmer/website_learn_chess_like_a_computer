# Dockerfile for GCP Stockfish API
FROM python:3.11-slim

# Install system dependencies
RUN apt-get update && apt-get install -y \
    wget \
    && rm -rf /var/lib/apt/lists/*

# Install Stockfish
RUN wget -q https://github.com/official-stockfish/Stockfish/releases/download/sf_16/stockfish-ubuntu-x86-64-avx2.tar \
    && tar -xf stockfish-ubuntu-x86-64-avx2.tar \
    && cp stockfish/stockfish-ubuntu-x86-64-avx2 /usr/local/bin/stockfish \
    && chmod +x /usr/local/bin/stockfish \
    && rm -rf stockfish stockfish-ubuntu-x86-64-avx2.tar

# Set working directory
WORKDIR /app

# Copy requirements and install Python dependencies
COPY requirements_gcp.txt .
RUN pip install --no-cache-dir -r requirements_gcp.txt

# Copy application code
COPY stockfish_api.py .

# Set environment variables
ENV PORT=8080
ENV HOST=0.0.0.0
ENV WORKERS=2

# Expose port
EXPOSE 8080

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
    CMD curl -f http://localhost:8080/health || exit 1

# Run with Gunicorn for production
# Using gthread worker for concurrent request handling
# 2 workers × 4 threads = 8 concurrent handlers per instance
# 2 workers × 4 engines/worker = 8 total engines (matches 8 CPU cores)
# Scale horizontally with multiple instances for higher throughput
CMD exec gunicorn --bind :$PORT --workers $WORKERS --threads 4 --timeout 60 --worker-class gthread stockfish_api:app