"""Gateway-side guard for the Codex CLI 0.147.0 empty-tool-description regression.

See https://github.com/openai/codex/issues/37380.

On the gpt-5.6-* model groups Codex sends no top-level ``tools`` array; the tools
arrive as a developer input item of type ``additional_tools``. Codex 0.147.0
(PR #37022) wraps them in ``namespace`` containers and emits the first one with
``"description": ""``. Azure's Responses validator enforces minLength 1 on
``description``, so every request 400s with::

    Invalid 'input[0].tools[0].description': empty string.  (code: empty_string)

OpenAI's own endpoint tolerates the empty string, which is why the regression
shipped. Codex <= 0.146.1 emits the tools flat, with real descriptions, and is
unaffected.

``description`` is REQUIRED on namespace tools -- dropping the key instead
yields ``missing_required_parameter`` -- so the empty value must be
SUBSTITUTED, never deleted.

Scope is deliberately narrow: this only rewrites TOOL DEFINITIONS -- the
top-level ``tools`` array, and the ``tools`` of an ``additional_tools`` input
item. Everything else is left byte-identical.

Two things it must not touch, both of which a looser walk gets wrong:

* **Message content and tool results.** Structured output echoed back in the
  conversation (say a tool that returned ``{"name": "widget",
  "description": ""}``) is caller DATA.
* **Transcript items that merely happen to carry a ``tools`` array**, notably
  ``mcp_list_tools``. That is a replayed record of a previous turn's output,
  not a definition being registered -- the provider does not validate it, so
  rewriting it fixes nothing.

In both cases the mutation would silently corrupt the transcript and invalidate
prompt-cache prefixes. Matching ``input`` items by ``type`` rather than by "has
a ``tools`` key" is what keeps that from happening; if a future client renames
the item, this stops applying, which is the correct way to fail.

This hook is a no-op for well-formed requests. Remove it once the Codex fix has
shipped and users have upgraded.
"""

from typing import Any

from litellm._logging import verbose_proxy_logger
from litellm.integrations.custom_logger import CustomLogger

# `input` item types that carry tool DEFINITIONS. Deliberately an allowlist --
# see the module docstring for why matching on "has a `tools` key" is unsafe.
_TOOL_DEFINITION_ITEM_TYPES = frozenset({"additional_tools"})


def _fix_tool_list(tools: Any) -> int:
    """Substitute empty ``description`` values on members of a ``tools`` array.

    Recurses only through nested ``tools`` arrays, which is how ``namespace``
    containers carry their children. Returns the number of substitutions made.
    """
    if not isinstance(tools, list):
        return 0

    fixed = 0
    for tool in tools:
        if not isinstance(tool, dict):
            continue
        fixed += _fix_tool(tool)
        # The chat/completions wire format nests the definition one level down;
        # the Responses API keeps it flat. Handle both.
        if isinstance(tool.get("function"), dict):
            fixed += _fix_tool(tool["function"])
        # `namespace` tools nest further tool definitions under their own key.
        if isinstance(tool.get("tools"), list):
            fixed += _fix_tool_list(tool["tools"])
    return fixed


def _fix_tool(tool: dict) -> int:
    """Substitute an empty ``description`` on one tool definition."""
    name = tool.get("name")
    if tool.get("description") == "" and isinstance(name, str) and name:
        tool["description"] = name
        return 1
    return 0


def fix_empty_descriptions(data: Any) -> int:
    """Patch tool definitions in a request body. Returns substitutions made."""
    if not isinstance(data, dict):
        return 0

    # Top-level tool definitions (chat/completions and the Responses API).
    fixed = _fix_tool_list(data.get("tools"))

    # Tools delivered as an input item -- Codex's `additional_tools` on gpt-5.6-*.
    # Matched by `type`, NOT by "has a tools key": other item types carry a
    # `tools` array too (`mcp_list_tools`), and those are transcript, not
    # definitions. See the module docstring.
    input_items = data.get("input")
    if isinstance(input_items, list):
        for item in input_items:
            if isinstance(item, dict) and item.get("type") in _TOOL_DEFINITION_ITEM_TYPES:
                fixed += _fix_tool_list(item.get("tools"))
    return fixed


class SanitizeEmptyDescriptions(CustomLogger):
    """Runs on every route (``call_type`` is unused -- chat, responses, etc.)."""

    _announced = False

    async def async_pre_call_hook(self, user_api_key_dict, cache, data, call_type):
        if not isinstance(data, dict):
            return data

        fixed = fix_empty_descriptions(data)
        if fixed:
            # Announce the first hit at INFO so the hook can be confirmed live
            # without turning on DEBUG for the whole proxy; stay quiet after.
            # With --num_workers N this fires up to N times, once per worker.
            if not SanitizeEmptyDescriptions._announced:
                SanitizeEmptyDescriptions._announced = True
                verbose_proxy_logger.info(
                    "sanitize_empty_descriptions: active -- patched %d empty tool description(s) "
                    "on a %s request (Codex 0.147.0 workaround, openai/codex#37380)",
                    fixed,
                    call_type,
                )
            else:
                verbose_proxy_logger.debug(
                    "sanitize_empty_descriptions: patched %d empty tool description(s) on %s",
                    fixed,
                    call_type,
                )

        return data


sanitize_handler = SanitizeEmptyDescriptions()
