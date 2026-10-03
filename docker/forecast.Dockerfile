FROM python:3.13-alpine@sha256:2dd78ad5cf13a0b68f5134dc49aa9950203a8cf4b7463431b9f3b398287c5059
WORKDIR /app
COPY ai-service/pyproject.toml ./
COPY ai-service/requirements.lock ./
COPY ai-service/app ./app
RUN pip install --no-cache-dir -r requirements.lock && pip install --no-cache-dir --no-deps . && adduser -D -u 1000 forecast
RUN pip uninstall -y setuptools && rm -rf /usr/local/lib/python3.13/site-packages/pip* /usr/local/bin/pip*
COPY docker/forecast-entry.py ./
USER forecast
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
CMD ["python", "forecast-entry.py"]
