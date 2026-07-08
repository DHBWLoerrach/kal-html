FROM python:3.12-slim

WORKDIR /app

RUN groupadd --gid 10001 appuser \
    && useradd --uid 10001 --gid appuser --home-dir /app --no-create-home --shell /usr/sbin/nologin appuser

COPY --chown=appuser:appuser server.py .
COPY --chown=appuser:appuser public ./public

USER appuser

EXPOSE 8000

CMD ["python", "-u", "server.py", "8000"]
