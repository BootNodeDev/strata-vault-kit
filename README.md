# strata-vault-kit

White-label tokenized vault on Stellar. An approved investor deposits USDC and
receives a share token representing their position; they return it and get their
USDC back.

Two rules the contract enforces:

1. **Only approved addresses can enter** — an allowlist maintained post-KYC.
2. **Exit is always allowed**, even for a de-listed holder. Funds are never
   trapped.

## Status

Milestone 1 is in progress: no yield, 1 in / 1 out. Testnet only.

Work is tracked in
[milestone M1 — White-label vault](https://github.com/BootNodeDev/strata-vault-kit/milestone/1).
Nothing here is production-ready, and nothing here has been audited.

This README is a placeholder. The product README, `architecture.md` and the
operator runbook land in issue #18.

## Reference base

Built on our own
[`stellar-vault-demo-dapp`](https://github.com/BootNodeDev/stellar-vault-demo-dapp),
a working testnet demo. This repo is the productized version of it: code moves
across deliberately, with the roles, pause and configuration the demo never had.
