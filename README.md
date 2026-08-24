# Beso Loom

Beso Loom is currently in bootstrap.

This repository starts with a deliberately stack-neutral foundation so the runtime architecture can be added without locking the project into a language or framework too early.

## Repository contract

- `manifest.json` — machine-readable project metadata.
- `manifest.schema.json` — JSON Schema describing the manifest contract.
- `scripts/validate_manifest.py` — dependency-free manifest validation used locally and in CI.
- `tests/test_manifest_validator.py` — regression tests for valid and invalid manifest cases.
- `.github/workflows/validate-manifest.yml` — automatic validation and tests on relevant pushes and pull requests.
- `.gitignore` — editor, operating-system, local-secret, and log noise only until the runtime stack is chosen.

## Validate locally

```bash
python3 scripts/validate_manifest.py
python3 -m unittest discover -s tests -v
```

A valid bootstrap manifest prints a short `manifest OK` message and exits with status 0. Invalid JSON, missing or unexpected fields, bad version/status values, or a broken schema reference fail with a non-zero exit status. The unit tests also lock these failure cases so future validator changes cannot silently weaken the contract.

## Status

Current phase: `bootstrap`

The repository foundation and metadata checks are now in place. The next implementation step is the agreed Beso Loom runtime/interface layer; the runtime language and framework remain intentionally undecided until that contract is defined.
