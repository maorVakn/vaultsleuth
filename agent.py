import os
import logging
import sys
from typing import Optional

from google import genai
from google.genai import types
from vault_tools import (
    check_token_capabilities,
    lookup_token,
    list_policies,
    get_policy_content,
    list_secret_engines,
    check_vault_health,
    diagnose_access,
    get_vault_addr,
)


logger = logging.getLogger(__name__)


def collect_diagnostic_context(user_prompt: str) -> dict:
    """Run Vault checks in the backend so Gemini cannot skip tool execution."""
    import re

    paths = re.findall(r"(?<![A-Za-z0-9_./-])(?:[A-Za-z0-9._-]+/)*[A-Za-z0-9._-]+(?:/[A-Za-z0-9._-]+)+", user_prompt)
    paths = list(dict.fromkeys(path.strip("`'\".,;:!?()[]{}") for path in paths))[:5]
    health = check_vault_health()
    token = lookup_token()
    safe_token = (
        {
            key: token[key]
            for key in ("display_name", "policies", "ttl", "renewable", "type")
            if key in token
        }
        if "error" not in token
        else token
    )
    safe_health = (
        {
            key: health[key]
            for key in ("status_code", "initialized", "sealed", "standby")
            if key in health
        }
        if "error" not in health
        else health
    )
    context = {
        "health": safe_health,
        "token": safe_token,
        "path_diagnostics": [diagnose_access(path) for path in paths],
    }
    if any(word in user_prompt.lower() for word in ("policy", "policies", "הרשאה", "מדיניות")):
        context["policies"] = list_policies()
    return context

def run_vault_sleuth_agent(user_prompt: str) -> Optional[str]:
    """Run the agent conversation loop with Gemini and automatic tool execution."""
    # Require an explicit token for non-local Vault servers. Local development
    # can use the dev token configured by docker-compose.yml.
    if not os.environ.get("VAULT_TOKEN") and get_vault_addr() not in {
        "http://127.0.0.1:8200",
        "http://localhost:8200",
    }:
        raise RuntimeError(
            "VAULT_TOKEN environment variable is not set. "
            "Set it before connecting to a non-local Vault server."
        )

    # Fail with a clear configuration message instead of the SDK's lower-level error.
    if not os.environ.get("GEMINI_API_KEY"):
        raise RuntimeError("GEMINI_API_KEY environment variable is not set")

    client = genai.Client(
        http_options=types.HttpOptions(api_version="v1beta")
    )

    diagnostic_context = collect_diagnostic_context(user_prompt)

    system_instruction = (
        "You are VaultSleuth, an expert AI assistant specialized in diagnosing and debugging HashiCorp Vault "
        "permission errors, policy misconfigurations, and access issues. "
        "You are given a JSON object containing results collected directly from read-only Vault tools. "
        "Base diagnoses strictly on those results; do not claim a check was run unless its result is present. "
        "Never assume a token is missing, invalid, or unauthorized without verifying it in the supplied results. "
        "Inspect the supplied results before diagnosing permission issues. If a result returns capabilities containing 'root', "
        "report that the current token has root capabilities on the requested path. "
        "Never invent tool results or claim that an inspection was performed when no result was supplied. "
        "If a tool returns an error or incomplete data, state that limitation clearly. "
        "Analyze the requested path, token metadata, and relevant policies methodically, explain the supported root cause, "
        "and recommend remediation without changing Vault configuration."
    )

    # Use gemini-2.5-flash for fast, cost-effective tool-calling loops
    try:
        response = client.models.generate_content(
            model="gemini-2.5-flash",
            contents=(
                f"User request:\n{user_prompt}\n\n"
                f"Verified Vault tool results (JSON):\n{diagnostic_context}"
        ),
            config=types.GenerateContentConfig(
                system_instruction=system_instruction,
                temperature=0.1,
            ),
        )
    except Exception as error:
        # SDK exception strings can contain request metadata. Do not return or log
        # them because this API handles credentials and infrastructure details.
        logger.error("Gemini request failed (%s)", type(error).__name__)
        raise RuntimeError("Gemini request failed. Check backend configuration and logs.") from None

    answer = getattr(response, "text", None)
    if not answer:
        candidates = getattr(response, "candidates", None) or []
        finish_reasons = [
            str(getattr(candidate, "finish_reason", "unknown")) for candidate in candidates
        ]
        detail = f" Finish reasons: {', '.join(finish_reasons)}." if finish_reasons else ""
        logger.warning("Gemini returned no text.%s", detail)
        return None

    return answer

if __name__ == "__main__":
    sample_prompt = (
        "I'm getting a permission denied error when trying to read from "
        "'secret/data/app/db'. Can you check why this is happening and inspect my policies?"
    )
    try:
        run_vault_sleuth_agent(sample_prompt)
    except RuntimeError as error:
        print(f"Configuration/runtime error: {error}", file=sys.stderr)
        raise SystemExit(1) from error
