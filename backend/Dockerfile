FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

WORKDIR /app

COPY backend/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

COPY backend/app ./app
COPY config ../config
COPY memory ../memory
COPY vector_db ../vector_db
COPY evals ../evals
COPY prompts ../prompts
COPY ml_systems ../ml_systems
COPY guardrails ../guardrails
COPY agents ../agents
COPY scripts ../scripts
COPY .mcp.json ../.mcp.json

RUN groupadd --system Synapse \
    && useradd --system --gid Synapse --uid 10001 Synapse \
    && mkdir -p /artifacts \
    && chown -R Synapse:Synapse /app /artifacts

USER Synapse

EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
