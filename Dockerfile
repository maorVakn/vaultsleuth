FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

# Copy dependency metadata and source files. The README is part of the build
# context so Hatchling can validate project metadata if packaging is enabled.
COPY pyproject.toml README.md ./
COPY agent.py vault_tools.py backend.py ./

# Install runtime dependencies declared by the project without installing the
# project itself. This avoids package build metadata and keeps versions aligned.
RUN pip install --no-cache-dir --upgrade pip \
    && pip install --no-cache-dir \
        'fastapi>=0.115.0' \
        'uvicorn[standard]>=0.30.0' \
        'google-genai>=1.0.0' \
        'hvac>=2.1.0' \
        'requests>=2.31.0' \
        'pydantic>=2.0.0'

EXPOSE 8000

CMD ["uvicorn", "backend:app", "--host", "0.0.0.0", "--port", "8000"]
