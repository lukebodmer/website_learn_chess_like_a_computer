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
ENV WORKERS=4

# Expose port
EXPOSE 8080

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
    CMD curl -f http://localhost:8080/health || exit 1

# Run with Gunicorn for production
CMD exec gunicorn --bind :$PORT --workers $WORKERS --timeout 300 --worker-class sync stockfish_api:app