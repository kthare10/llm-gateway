FROM python:3.12-slim

WORKDIR /app

COPY pyproject.toml .
COPY gateway_api/ gateway_api/

RUN pip install --no-cache-dir .

EXPOSE 8000

CMD ["uvicorn", "gateway_api.main:app", "--host", "0.0.0.0", "--port", "8000"]
