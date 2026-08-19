# 6. Upstream policy, and the authorized fallback for #674

Status: accepted

## Context

Gaps found in OZ primitives so far:
[#560](https://github.com/OpenZeppelin/stellar-contracts/issues/560)
(composition),
[#674](https://github.com/OpenZeppelin/stellar-contracts/issues/674)
(conversions ignore `total_assets` overrides — blocks attested-NAV accounting),
and
[openzeppelin-adapters#72](https://github.com/OpenZeppelin/openzeppelin-adapters/issues/72)
(Role Manager grant/revoke, found and filed by us). Waiting on upstream
responses would put third parties on our critical path. The roadmap also
prohibited rewriting conversion math without a formal decision — this ADR is
that decision, made in advance.

## Decision

Every gap gets an upstream comment or PR with this repo as evidence, plus a
local workaround marked `// WORKAROUND(OZ#nnn): <what> — delete when <trigger>`
(greppable; a workaround without this marker is a process bug). Upstream never
sits on the critical path. Specifically for #674: if the fix has not shipped in
an audited release when attested-NAV accounting lands, a fork-minimal wrapper is
pre-authorized — it may override only the conversion entrypoints, must delegate
every other line to the audited crate, must carry a parity test against OZ
behavior at zero off-chain value, and must carry the deletion trigger.

## Consequences

- Workarounds are enumerable (`grep WORKAROUND`), each with its exit condition.
- The #674 wrapper is the only sanctioned hand-rolled money math, bounded and
  deletable.
