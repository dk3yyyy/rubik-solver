# syntax=docker/dockerfile:1

# --- Stage 1: Build the frontend -------------------------------------------
FROM node:22-slim AS frontend-build

WORKDIR /app/frontend

# Install deps first so Docker caches this layer when only source files change.
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci

# Copy source and build.
COPY frontend/ ./
RUN npm run build

# --- Stage 2: Backend with the built frontend ------------------------------
FROM python:3.12-slim

# OpenCV needs libgl and libglib at runtime.
RUN apt-get update \
    && apt-get install -y --no-install-recommends libgl1 libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install Python deps first for layer caching.
COPY backend/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# Copy backend source.
COPY backend/ ./backend/

# Copy the built frontend from stage 1 into the path main.py expects.
COPY --from=frontend-build /app/frontend/dist ./frontend/dist

# Run as a non-root user.
RUN adduser --disabled-password --gecos "" appuser
USER appuser

EXPOSE 8000

# uvicorn main:app lives in /app/backend, so run from there.
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
