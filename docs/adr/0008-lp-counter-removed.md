# 8. LP counter removed from the contract

Status: accepted

## Context

The reference base kept an on-chain counter of liquidity providers. No product
requirement consumes it; on-chain counters add state that every entry/exit must
touch, creating footprint contention under concurrency.

## Decision

Removed. If the dashboard needs the figure, it is reconstructed off-chain from
events.

## Consequences

- One less write per deposit/withdraw and one less contention point.
- An on-chain holder-limit requirement, if it ever appears, is a new feature
  with its own design — not this counter revived.
