# 3. Five full-name roles; Role Manager is read-only, execution in /admin

Status: accepted

## Context

Access control moves from `Ownable` to `stellar-access` AccessControl with five
roles. `symbol_short!` caps at 9 characters, so `governance`, `compliance` and
`attestation` cannot be compile-time constants. The roadmap assumed OpenZeppelin
Role Manager as the full governance UI. The spike
([#7](https://github.com/BootNodeDev/open-rwa-vault/issues/7)) verified it
against a live testnet contract: detection, role listing and admin transfers
work; `grant_role`/`revoke_role` fail against OZ ≥0.6.0 (argument-order bug we
reported upstream:
[openzeppelin-adapters#72](https://github.com/OpenZeppelin/openzeppelin-adapters/issues/72)),
its execution path has no Stellar multisig support, and the hosted instance is
testnet-only. Roles are discovered from indexed grant events, so a role never
granted is invisible to the tool.

## Decision

Roles are declared with runtime `Symbol::new` and full names — `governance`,
`compliance`, `attestation`, `treasury`, `guardian` — matching the pattern OZ's
own generator uses. All five are granted at deploy time. Role Manager is scoped
to visualization, audit and history; role mutations and pause execute through
the admin panel's signing-harness forms (compose → sign → share → submit), which
the multisig authorities require anyway.

## Consequences

- The deploy script grants every role so tooling renders them from day one.
- The /admin surface gains grant/revoke forms; the runbook documents Role
  Manager as the verification step after each operation.
- Self-hosting Role Manager is a mainnet-track task, not needed for testnet.
