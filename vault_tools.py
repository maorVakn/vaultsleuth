"""Read-only helpers for diagnosing Vault access and configuration issues."""

import os
from typing import Any, Dict, Optional
from urllib.parse import quote

import requests


LOCAL_DEV_TOKEN = "dev-token"


def get_vault_addr() -> str:
    """Get the Vault address from the environment or use the local dev default."""
    return os.environ.get("VAULT_ADDR", "http://127.0.0.1:8200").rstrip("/")


def _get_token() -> Optional[str]:
    """Resolve a token without embedding it in an LLM prompt or tool schema.

    The local fallback matches docker-compose.yml's Vault dev server only.
    """
    token = os.environ.get("VAULT_TOKEN")
    if token and token.strip():
        return token.strip()

    if get_vault_addr() in {"http://127.0.0.1:8200", "http://localhost:8200"}:
        return LOCAL_DEV_TOKEN

    return None


def _missing_token() -> Dict[str, str]:
    return {"error": "VAULT_TOKEN is not set"}


def _request_error(error: requests.exceptions.RequestException) -> Dict[str, str]:
    # Request exceptions can include full URLs. Avoid forwarding infrastructure
    # details (and potentially query parameters) into API responses or Gemini.
    return {"error": f"Vault request failed ({type(error).__name__})"}


def _http_error(response: requests.Response) -> Dict[str, str]:
    """Return only the status; Vault response bodies may contain sensitive data."""
    return {"error": f"Vault returned HTTP {response.status_code}"}


def _response_data(response: requests.Response) -> Dict[str, Any]:
    """Decode a Vault JSON response and return a useful error for bad payloads."""
    try:
        payload = response.json()
    except requests.exceptions.JSONDecodeError:
        return {"error": "Vault returned an invalid JSON response"}
    if not isinstance(payload, dict):
        return {"error": "Vault returned an unexpected JSON response"}
    data = payload.get("data", {})
    if not isinstance(data, dict):
        return {"error": "Vault returned an unexpected data payload"}
    return data


def check_token_capabilities(path: str) -> Dict[str, Any]:
    """Check the current token's capabilities on a path."""
    token = _get_token()
    if not token:
        return _missing_token()

    url = f"{get_vault_addr()}/v1/sys/capabilities-self"
    try:
        response = requests.post(
            url,
            headers={"X-Vault-Token": token},
            json={"path": path},
            timeout=10,
        )
        if response.ok:
            return _response_data(response)
        return _http_error(response)
    except requests.exceptions.RequestException as error:
        return _request_error(error)


def diagnose_access(path: str) -> Dict[str, Any]:
    """Summarize whether the current token can read or write a path."""
    result = check_token_capabilities(path)
    if "error" in result:
        return {"path": path, **result}

    capabilities = result.get("capabilities", [])
    is_root = "root" in capabilities
    return {
        "path": path,
        "capabilities": capabilities,
        "has_read": is_root or "read" in capabilities,
        "has_write": is_root or any(
            capability in capabilities for capability in ("create", "update", "patch")
        ),
    }


def lookup_token() -> Dict[str, Any]:
    """Look up metadata for the current token (lookup-self)."""
    token = _get_token()
    if not token:
        return _missing_token()
    try:
        response = requests.get(
            f"{get_vault_addr()}/v1/auth/token/lookup-self",
            headers={"X-Vault-Token": token},
            timeout=10,
        )
        if response.ok:
            return _response_data(response)
        return _http_error(response)
    except requests.exceptions.RequestException as error:
        return _request_error(error)


def list_policies() -> Dict[str, Any]:
    """List ACL policy names visible to the current token."""
    token = _get_token()
    if not token:
        return _missing_token()
    try:
        response = requests.get(
            f"{get_vault_addr()}/v1/sys/policies/acl",
            headers={"X-Vault-Token": token},
            params={"list": "true"},
            timeout=10,
        )
        if response.ok:
            return _response_data(response)
        return _http_error(response)
    except requests.exceptions.RequestException as error:
        return _request_error(error)


def get_policy_content(name: str) -> Dict[str, Any]:
    """Read an ACL policy's HCL source by policy name."""
    token = _get_token()
    if not token:
        return _missing_token()
    safe_name = quote(name, safe="")
    try:
        response = requests.get(
            f"{get_vault_addr()}/v1/sys/policies/acl/{safe_name}",
            headers={"X-Vault-Token": token},
            timeout=10,
        )
        if response.ok:
            return _response_data(response)
        return _http_error(response)
    except requests.exceptions.RequestException as error:
        return _request_error(error)


def list_secret_engines() -> Dict[str, Any]:
    """List mounted secret engines and their configuration metadata."""
    token = _get_token()
    if not token:
        return _missing_token()
    try:
        response = requests.get(
            f"{get_vault_addr()}/v1/sys/mounts",
            headers={"X-Vault-Token": token},
            timeout=10,
        )
        if response.ok:
            mounts = _response_data(response)
            if "error" in mounts:
                return mounts
            return {
                path: {"type": info.get("type"), "options": info.get("options")}
                for path, info in mounts.items()
            }
        return _http_error(response)
    except requests.exceptions.RequestException as error:
        return _request_error(error)


def check_vault_health() -> Dict[str, Any]:
    """Check Vault health and seal status without an authentication token."""
    try:
        response = requests.get(f"{get_vault_addr()}/v1/sys/health", timeout=10)
        try:
            data = response.json() if response.content else {}
        except (requests.exceptions.JSONDecodeError, ValueError):
            data = {"error": "Invalid JSON response"}
        return {
            "status_code": response.status_code,
            "data": data,
            "initialized": data.get("initialized"),
            "sealed": data.get("sealed"),
            "standby": data.get("standby"),
        }
    except requests.exceptions.RequestException as error:
        return _request_error(error)


if __name__ == "__main__":
    print(diagnose_access("secret/data/app/db"))
