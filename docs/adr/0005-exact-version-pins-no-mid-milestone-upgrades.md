# 5. Exact version pins; upgrades never mid-milestone

Status: accepted

## Context

The OZ 0.7.x line has a published audit; soroban-sdk 27.x is incompatible with
OZ 0.7.2 (coupled to sdk 26). A dependency bump mid-milestone invalidates tested
behavior at the worst possible time.

## Decision

Exact pins: `stellar-*` = 0.7.2, `soroban-sdk` 26.x. Dependency upgrades are
never performed mid-milestone; each migration is its own issue in the following
milestone.

## Consequences

- Dependabot needs a cargo ecosystem entry plus an ignore rule for soroban-sdk
  major bumps.
- A compatible OZ release triggers a migration issue, not a hot swap.
