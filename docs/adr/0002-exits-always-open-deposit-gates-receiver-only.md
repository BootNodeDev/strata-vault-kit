# 2. Exits always open; deposits gate the receiver only

Status: accepted

## Context

The vault enforces a post-KYC allowlist, but a compliance vault that can trap
funds is worse than no vault. The open question was whether the deposit payer
must also be allowlisted, or only the receiver of the shares.

## Decision

`withdraw`/`redeem` (and any future redemption-claim path) are never
allowlist-gated and never pausable: a de-listed holder can always leave.
`deposit`/`mint` gate the receiver only. The payer is not checked — USDC carries
its own compliance on the asset side; the regulated asset here is the share, and
shares can only land in allowlisted hands.

## Consequences

- Third-party funding (custodian or treasury paying for an allowlisted investor)
  is accepted behavior.
- Pause blocks entries and transfers only.
- Every change to an exit path must preserve the invariant, and tests assert
  that exits work for de-listed holders and while paused.
