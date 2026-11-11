"""HTTP API for the VaultSleuth frontend."""

import os
import logging
from typing import Any, Dict, Optional
from urllib.parse import urlparse

import requests
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field, field_validator

from agent import run_vault_sleuth_agent
from vault_tools import get_vault_addr, lookup_token


class ChatRequest(BaseModel):
    message: str = Field(min_length=1, max_length=8000)

    @field_validator("message")
    @classmethod
    def message_must_not_be_blank(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("message must not be blank")
        return value.strip()


class ChatResponse(BaseModel):
    answer: str


app = FastAPI(
    title="VaultSleuth API",
    version="0.1.0",
    description="Backend API for read-only Vault access diagnosis.",
)
logger = logging.getLogger(__name__)

allowed_origins = [
    origin.strip()
    for origin in os.environ.get(
        "VAULTSLEUTH_ALLOWED_ORIGINS",
        "http://localhost:3000,http://127.0.0.1:3000,http://localhost:5173,http://127.0.0.1:5173",
    ).split(",")
    if origin.strip()
]
app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=False,
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type", "Authorization"],
)


def _validate_vault_target(address: str) -> None:
    parsed = urlparse(address)
    host = (parsed.hostname or "").lower()
    allow_private = os.environ.get("VAULTSLEUTH_ALLOW_PRIVATE_VAULT", "true").lower() == "true"
    if host in {"localhost", "127.0.0.1", "::1", "vault"}:
        return
    if not allow_private:
        raise HTTPException(
            status_code=400,
            detail="Remote Vault targets are disabled by VAULTSLEUTH_ALLOW_PRIVATE_VAULT.",
        )


@app.get("/health")
def health() -> Dict[str, str]:
    return {"status": "ok", "service": "vaultsleuth-api"}


@app.get("/api/config")
def get_config() -> Dict[str, Any]:
    """Return configuration status without exposing addresses or credentials."""
    return {
        "gemini_configured": bool(os.environ.get("GEMINI_API_KEY")),
        "vault_token_configured": bool(os.environ.get("VAULT_TOKEN"))
        or get_vault_addr() in {"http://127.0.0.1:8200", "http://localhost:8200"},
    }


@app.post("/api/vault/check")
def check_vault() -> Dict[str, Any]:
    """Check health and token validity without exposing token data."""
    address = get_vault_addr()
    _validate_vault_target(address)
    try:
        health_response = requests.get(f"{address}/v1/sys/health", timeout=8)
    except requests.RequestException as error:
        logger.warning("Vault health request failed (%s)", type(error).__name__)
        return {"reachable": False, "error": "Vault health request failed."}

    try:
        health_payload = health_response.json() if health_response.content else {}
        if not isinstance(health_payload, dict):
            health_payload = {}
    except ValueError:
        health_payload = {}

    token_data: Optional[Dict[str, Any]] = None
    token_error: Optional[str] = None
    if os.environ.get("VAULT_TOKEN") or address in {
        "http://127.0.0.1:8200",
        "http://localhost:8200",
    }:
        result = lookup_token()
        if "error" in result:
            token_error = result["error"]
        else:
            token_data = {
                "display_name": result.get("display_name"),
                "policies": result.get("policies", []),
                "ttl": result.get("ttl"),
                "renewable": result.get("renewable"),
            }

    return {
        "reachable": True,
        "health_status_code": health_response.status_code,
        "health": {
            key: health_payload.get(key)
            for key in ("initialized", "sealed", "standby")
            if key in health_payload
        },
        "token_valid": token_data is not None,
        "token": token_data,
        "token_error": token_error,
    }


@app.post("/api/chat", response_model=ChatResponse)
def chat(request: ChatRequest) -> ChatResponse:
    """Run a Vault diagnosis. Credentials stay on the backend."""
    _validate_vault_target(get_vault_addr())
    try:
        answer = run_vault_sleuth_agent(request.message)
    except RuntimeError as error:
        # Only known, intentionally sanitized runtime messages reach the client.
        raise HTTPException(status_code=503, detail=str(error)) from None
    if not answer:
        raise HTTPException(status_code=502, detail="Gemini returned no text response.")
    return ChatResponse(answer=answer)
