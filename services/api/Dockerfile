FROM python:3.11-slim

WORKDIR /app

COPY pyproject.toml ./
COPY app ./app
COPY alembic.ini ./
COPY migrations ./migrations

RUN pip install --no-cache-dir .

EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
