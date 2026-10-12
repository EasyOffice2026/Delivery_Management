FROM node:24-bookworm-slim AS frontend
WORKDIR /build/frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

FROM python:3.12-slim-bookworm
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    DMS_DB_PATH=/var/data/delivery.db \
    DMS_COOKIE_SECURE=1 \
    PORT=10000
WORKDIR /app/backend
COPY backend/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt \
    && useradd --create-home --shell /bin/bash dms \
    && mkdir -p /var/data /home/dms/.ssh \
    && chown -R dms:dms /var/data /home/dms/.ssh \
    && chmod 0700 /home/dms/.ssh
COPY backend/app/ ./app/
COPY --from=frontend /build/frontend/dist/ /app/frontend/dist/
USER dms
EXPOSE 10000
CMD ["sh", "-c", "exec uvicorn app.main:app --host 0.0.0.0 --port \"${PORT}\" --no-proxy-headers"]
