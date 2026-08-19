# 4. Authorities are native Stellar multisig accounts

Status: accepted

## Context

Separation of duties requires each privileged role to be held by a multi-party
authority. Stellar accounts support signers, weights and thresholds natively
(`SetOptions`), proven in the current testnet deployment.

## Decision

Each authority is a native Stellar multisig G-account. Contracts check only the
account's authorization; no multisig logic is reimplemented on-chain.

## Consequences

- Any execution surface must support multi-signature collection. The signing
  harness does; Role Manager does not (see ADR-0003).
- The deploy tooling creates and configures the authority accounts as part of a
  reproducible setup.
