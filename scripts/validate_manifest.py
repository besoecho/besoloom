#!/usr/bin/env python3
"""Validate a Beso Loom manifest using only the Python standard library."""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_MANIFEST_PATH = ROOT / "manifest.json"
DEFAULT_SCHEMA_PATH = ROOT / "manifest.schema.json"


class ValidationError(ValueError):
    """Raised when a manifest does not satisfy the Beso Loom contract."""


def load_json(path: Path) -> dict:
    try:
        with path.open("r", encoding="utf-8") as handle:
            value = json.load(handle)
    except FileNotFoundError as exc:
        raise ValidationError(f"missing {path}") from exc
    except json.JSONDecodeError as exc:
        raise ValidationError(f"invalid JSON in {path}: {exc}") from exc

    if not isinstance(value, dict):
        raise ValidationError(f"{path} must contain a JSON object")
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


def validate(manifest: dict, schema: dict) -> None:
    required = schema.get("required", [])
    missing = [key for key in required if key not in manifest]
    if missing:
        raise ValidationError(f"missing required field(s): {', '.join(missing)}")

    properties = schema.get("properties", {})
    if schema.get("additionalProperties") is False:
        extra = sorted(set(manifest) - set(properties))
        if extra:
            raise ValidationError(f"unexpected field(s): {', '.join(extra)}")

    for key, rules in properties.items():
        if key not in manifest:
            continue

        value = manifest[key]
        expected_type = rules.get("type")
        if expected_type and not type_matches(value, expected_type):
            raise ValidationError(f"{key!r} must be of type {expected_type}")

        if isinstance(value, int) and "minimum" in rules and value < rules["minimum"]:
            raise ValidationError(f"{key!r} must be >= {rules['minimum']}")

        if isinstance(value, str):
            if "minLength" in rules and len(value) < rules["minLength"]:
                raise ValidationError(
                    f"{key!r} is shorter than {rules['minLength']} character(s)"
                )

            pattern = rules.get("pattern")
            if pattern and re.fullmatch(pattern, value) is None:
                raise ValidationError(f"{key!r} does not match pattern {pattern!r}")

            enum = rules.get("enum")
            if enum and value not in enum:
                raise ValidationError(f"{key!r} must be one of: {', '.join(enum)}")

            if rules.get("format") == "uri" and not validate_uri(value):
                raise ValidationError(f"{key!r} must be a valid URI")

    if manifest.get("$schema") != "./manifest.schema.json":
        raise ValidationError("'$schema' must point to ./manifest.schema.json")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Validate a Beso Loom manifest")
    parser.add_argument(
        "--manifest",
        type=Path,
        default=DEFAULT_MANIFEST_PATH,
        help="manifest JSON file (default: repository manifest.json)",
    )
    parser.add_argument(
        "--schema",
        type=Path,
        default=DEFAULT_SCHEMA_PATH,
        help="schema JSON file (default: repository manifest.schema.json)",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    try:
        manifest = load_json(args.manifest)
        schema = load_json(args.schema)
        validate(manifest, schema)
    except ValidationError as exc:
        print(f"manifest validation failed: {exc}", file=sys.stderr)
        raise SystemExit(1) from exc

    print(
        f"manifest OK: {manifest.get('name', '<unnamed>')} "
        f"v{manifest.get('version', '<unknown>')} ({manifest.get('status', '<unknown>')})"
    )


if __name__ == "__main__":
    main()
