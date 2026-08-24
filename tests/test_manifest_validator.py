from __future__ import annotations

import copy
import json
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from validate_manifest import ValidationError, validate  # noqa: E402


class ManifestValidatorTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.manifest = json.loads((ROOT / "manifest.json").read_text(encoding="utf-8"))
        cls.schema = json.loads((ROOT / "manifest.schema.json").read_text(encoding="utf-8"))

    def test_repository_manifest_is_valid(self) -> None:
        validate(self.manifest, self.schema)

    def test_missing_required_field_fails(self) -> None:
        manifest = copy.deepcopy(self.manifest)
        del manifest["name"]
        with self.assertRaisesRegex(ValidationError, "missing required field"):
            validate(manifest, self.schema)

    def test_unknown_field_fails(self) -> None:
        manifest = copy.deepcopy(self.manifest)
        manifest["surprise"] = True
        with self.assertRaisesRegex(ValidationError, "unexpected field"):
            validate(manifest, self.schema)

    def test_invalid_version_fails(self) -> None:
        manifest = copy.deepcopy(self.manifest)
        manifest["version"] = "v0.1"
        with self.assertRaisesRegex(ValidationError, "does not match pattern"):
            validate(manifest, self.schema)

    def test_invalid_status_fails(self) -> None:
        manifest = copy.deepcopy(self.manifest)
        manifest["status"] = "maybe"
        with self.assertRaisesRegex(ValidationError, "must be one of"):
            validate(manifest, self.schema)

    def test_wrong_schema_reference_fails(self) -> None:
        manifest = copy.deepcopy(self.manifest)
        manifest["$schema"] = "elsewhere.json"
        with self.assertRaisesRegex(ValidationError, "must point to"):
            validate(manifest, self.schema)


if __name__ == "__main__":
    unittest.main()
