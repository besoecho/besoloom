#!/usr/bin/env python3
"""Validate manifest.json against the subset of JSON Schema used by Beso Loom.

This intentionally uses only the Python standard library so repository checks do
not depend on the eventual Beso Loom runtime stack.
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parents[1]
MANIFEST_PATH = ROOT / "manifest.json"
SCHEMA_PATH = ROOT / "manifest.schema.json"


def fail(message: str) -> None:
    print(f"manifest validation failed: {message}", file=sys.stderr)
    raise SystemExit(1)


def load_json(path: Path) -> dict:
    try:
        with path.open("r", encoding="utf-8") as handle:
            value = json.load(handle)
    except FileNotFoundError:
        fail(f"missing {path.relative_to(ROOT)}")
    except json.JSONDecodeError as exc:
        fail(f"invalid JSON in {path.relative_to(ROOT)}: {exc}")

    if not isinstance(value, dict):
        fail(f"{path.relative_to(ROOT)} must contain a JSON object")
    return value


def type_matches(value: object, expected: str) -> bool:
    if expected == "string":
        return isinstance(value, str)
    if expected == "integer":
        return isinstance(value, int) and not isinstance(value, bool)
    if expected == "object":
        return isinstance(value, dict)
    return True


def validate_uri(value: str) -> bool:
    parsed = urlparse(value)
    return bool(parsed.scheme and (parsed.netloc or parsed.path))


def main() -> None:
    manifest = load_json(MANIFEST_PATH)
    schema = load_json(SCHEMA_PATH)

    required = schema.get("required", [])
    missing = [key for key in required if key not in manifest]
    if missing:
        fail(f"missing required field(s): {', '.join(missing)}")

    properties = schema.get("properties", {})
    if schema.get("additionalProperties") is False:
        extra = sorted(set(manifest) - set(properties))
        if extra:
            fail(f"unexpected field(s): {', '.join(extra)}")

    for key, rules in properties.items():
        if key not in manifest:
            continue

        value = manifest[key]
        expected_type = rules.get("type")
        if expected_type and not type_matches(value, expected_type):
            fail(f"{key!r} must be of type {expected_type}")

        if isinstance(value, int) and "minimum" in rules and value < rules["minimum"]:
            fail(f"{key!r} must be >= {rules['minimum']}")

        if isinstance(value, str):
            if "minLength" in rules and len(value) < rules["minLength"]:
                fail(f"{key!r} is shorter than {rules['minLength']} character(s)")

            pattern = rules.get("pattern")
            if pattern and re.fullmatch(pattern, value) is None:
                fail(f"{key!r} does not match pattern {pattern!r}")

            enum = rules.get("enum")
            if enum and value not in enum:
                fail(f"{key!r} must be one of: {', '.join(enum)}")

            if rules.get("format") == "uri" and not validate_uri(value):
                fail(f"{key!r} must be a valid URI")

    schema_ref = manifest.get("$schema")
    if schema_ref != "./manifest.schema.json":
        fail("'$schema' must point to ./manifest.schema.json")

    print(
        f"manifest OK: {manifest.get('name', '<unnamed>')} "
        f"v{manifest.get('version', '<unknown>')} ({manifest.get('status', '<unknown>')})"
    )


if __name__ == "__main__":
    main()
