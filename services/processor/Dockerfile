FROM python:3.11-slim

WORKDIR /app

COPY pyproject.toml ./
COPY processor ./processor

RUN pip install --no-cache-dir .

CMD ["python", "-m", "processor.main"]
