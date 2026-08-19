# 1. Composition via explicit leaf overrides

Status: accepted

## Context

OpenZeppelin stellar-contracts routes token behavior through a single
`type ContractType` slot, making flavors mutually exclusive: `Vault` and
`AllowList` cannot compose as types
([#560](https://github.com/OpenZeppelin/stellar-contracts/issues/560)). Upstream
fixes are in flux (`Compose`,
[PR #821](https://github.com/OpenZeppelin/stellar-contracts/pull/821), open and
unaudited). The same convergence exists across Rust chains: cw20-base's
documented extension pattern is explicit delegation from the final contract, not
type-level composition.

## Decision

`ContractType = Vault` stays intact so share math remains 100% OpenZeppelin.
`AllowList` is reused as a storage module, and every gate is written in this
contract's own entrypoint overrides. This is the design, not a stopgap: adopting
a future upstream composition mechanism is a governance option to be evaluated
on its merits, never a scheduled migration.

## Consequences

- The storage layout stays upstream-compatible either way.
- Every gated entrypoint needs an explicit test (the check is code we own).
- The earlier plan to "delete manual overrides when #560 ships audited" is void;
  #560 is tracked only as a potential simplification.
