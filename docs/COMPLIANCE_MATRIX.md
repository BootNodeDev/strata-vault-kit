# Compliance & Freeze Matrix Across Vault Lifecycle

This document is the authoritative specification of identity, allowlist, and freeze behavior across all Strata vault lifecycle operations. It formally defines the interaction between the asynchronous vault, the SEP-57 compliant share token, and the on-chain identity verifier.

---

## 1. Investor States

Every investor account in the vault ecosystem exists in one of three primary compliance states:

1. **Allowlisted (`Allowed`)**:
   - The account is verified by the KYC / onboarding provider and recorded on `IdentityVerifier` (`is_allowed(account) == true`).
   - The account is not subject to sanctions or administrative freezes (`is_frozen(account) == false`).
   - Full access to all protocol features (subscriptions, secondary transfers, cancellations, redemptions).

2. **De-listed / Non-Frozen (`Delisted`)**:
   - The account's KYC has expired, been revoked, or onboarding was not completed (`is_allowed(account) == false`).
   - The account is **not** frozen under court order or regulatory sanctions (`is_frozen(account) == false`).
   - The account may not acquire or receive new shares, but **must be permitted to exit into cash**.

3. **Frozen (`Frozen`)**:
   - The account is subject to sanctions, legal freezing, or security hold (`is_frozen(account) == true` via `ShareToken::set_address_frozen`).
   - The share token refuses a `transfer` from or to a frozen address. Minting does not check freezes, and `forced_transfer` ignores them.
   - A frozen investor is outside the payable-claims guarantee (design document §8.1). The vault does not check freezes today, so a frozen holder's exit still goes through; the kit does not promise it.

---

## 2. Operation Matrix

| Operation | Allowlisted | De-listed (Non-Frozen) | Frozen (Address or Partial) | Contract Mechanics & Regulatory Rationale |
|---|---|---|---|---|
| **`request_deposit`** | ✅ Allowed | ⚠️ Allowed by SAC | ⚠️ Allowed by SAC | SAC USDC transfer moves funds into cancellable escrow. The vault does not check `IdentityVerifier` at subscription time to avoid coupling to external registry gas or third-party downtime. |
| **`cancel_deposit`** | ✅ Allowed | ✅ **Allowed** | ✅ **Allowed** | **Escape Hatch**: Calls `refund_deposit`. Escrowed settlement asset (USDC) is refunded directly to `controller`. Cash refunds bypass share token compliance checks. |
| **`claim_deposit`** | ✅ Allowed | ❌ **Refused** | ⚠️ Minted if allowlisted | `ShareClient::mint` calls `verify_identity` and `can_create`, and does not check freezes. A de-listed receiver is refused with `IdentityVerificationFailed`. A frozen receiver still on the allowlist is minted, and cannot transfer those shares while frozen. |
| **`request_redeem`** | ✅ Allowed | ✅ **Allowed** | ⚠️ Allowed, not guaranteed | **Exit Right**: the vault escrows the shares with `ShareClient::forced_transfer`, which checks neither the allowlist nor freezes, so a de-listed holder can start an exit. It also releases as much of a partial freeze as the escrow needs. |
| **`cancel_redeem`** | ✅ Allowed | ❌ **Refused** | ❌ **Refused** | `return_shares` uses standard `ShareClient::transfer(vault, controller, shares)`, which executes `can_transfer`. Reverts if `controller` is de-listed or frozen. Holder cannot re-acquire shares. |
| **`claim_redeem`** | ✅ Allowed | ✅ **Allowed** | ⚠️ Pays, not guaranteed | **Exit-Only Cash Path**: the settlement asset pays out from the liquid reserve and the escrowed shares are burned from the vault. The cash claim checks neither the allowlist nor freezes. |
| **`transfer`** (Secondary) | ✅ Allowed | ❌ **Refused** | ❌ **Refused** | Standard peer-to-peer share transfer via SEP-57. Requires both sender and receiver to be allowlisted and neither to be frozen. |

---

## 3. Deep Dive into Key Lifecycle Invariants

### 3.1 The Exit-Only Cash Path
A core guarantee of the Strata Vault Kit is that **a de-listed, non-frozen investor can always leave the fund in cash**. A frozen investor is outside this guarantee, as the design document states in §8.1: the vault does not check freezes today, so their exit goes through, but nothing promises it.

- **Mechanism**:
  1. A de-listed holder queues an exit via `request_redeem`. The vault escrows the shares with `forced_transfer`.
  2. The epoch closes and is priced via attestation.
  3. Once priced and covered, the cash liability is committed.
  4. The investor calls `claim_redeem`. The cash payout transfers the settlement asset (USDC) directly to the investor's Stellar account, while the shares are burned from the vault's own balance.
  5. The cash transfer never queries `IdentityVerifier` or `ShareToken::is_frozen`. Once priced and covered, cash exits cannot be blocked.

### 3.2 Deposit Cancellation for De-Listed Investors
If an investor deposits into an open epoch but is de-listed (or KYC expires) before the epoch is priced:
- The investor is permitted to call `cancel_deposit(investor, epoch_id)`.
- `refund_deposit` transfers the escrowed USDC back to the investor.
- Because no shares were minted, returning cash restores the investor's funds without violating share token compliance rules.

### 3.3 De-Listing Between Deposit Request and Claim
If an investor deposits while allowlisted, but is de-listed after the epoch is closed and priced:
- **`claim_deposit` is refused**: The vault calls `ShareClient::mint`, which evaluates `can_create`. Because the receiver is no longer allowlisted, `verify_identity` fails with `IdentityVerificationFailed`.
- **`cancel_deposit` is blocked**: The epoch is already `Fulfilled`. As an anti-arbitrage safeguard, once an epoch has taken a valuation, cancellation is permanently closed (`VaultError::AlreadyPriced`).
- **Resolution**: The investor's settlement capital remains safely in vault escrow. The investor can either:
  1. Complete KYC refresh, upon which compliance re-allowlists the account and `claim_deposit` succeeds; or
  2. Compliance / governance resolves the claim out-of-band.

### 3.4 Redemption Cancellation Refusal
When an investor requests redemption, their shares are transferred to the vault.
If the investor becomes de-listed or frozen before pricing:
- Calling `cancel_redeem` requires transferring shares from the vault back to the investor's account (`return_shares`).
- `ShareToken::transfer` refuses a frozen receiver (`AddressFrozen`) and a receiver off the allowlist (`IdentityVerificationFailed`), so returning the shares is refused.
- The investor is not allowed to re-enter share possession. They remain in the queue and exit into cash upon epoch fulfillment.

---

## 4. Where the Checks Live (OpenZeppelin `stellar-tokens` 0.7.2)

The share token is OpenZeppelin's RWA token. The allowlist and freeze checks sit in the token's own operations, not in compliance hooks:

| Token operation | Freeze check | Allowlist check (`verify_identity`) | Compliance hooks |
|---|---|---|---|
| `transfer` | Refuses if sender or receiver is frozen; the sender needs enough unfrozen balance | Sender and receiver | `can_transfer` before, `transferred` after |
| `mint` | None | Receiver | `can_create` before, `created` after |
| `forced_transfer` | None; releases as much of a partial freeze as the amount needs | None | `transferred` after |
| `burn` | None; releases as much of a partial freeze as the amount needs | None | `destroyed` after |

0.7.2 has five compliance hooks: `can_transfer` and `can_create` are asked before the state change, and `transferred`, `created` and `destroyed` are told after it. There is no `can_destroy`.

The kit's compliance contract registers no modules, so `can_transfer` and `can_create` always allow today. Until rule modules are added, the allowlist and freeze rules are exactly the token checks in the table above.

---

## 5. Automated Test Coverage

The behavior specified in this matrix is verified by on-chain automated test suites in [`contracts/async-vault/src/test/compliance.rs`](../contracts/async-vault/src/test/compliance.rs):

* `a_non_allowlisted_investor_cannot_claim_shares`: Verifies unallowlisted caller cannot mint shares on claim.
* `allowlisting_after_the_fact_lets_the_claim_through`: Verifies KYC restoration unblocks claim.
* `a_delisted_holder_can_still_queue_an_exit`: Verifies de-listed holders can queue redemption via forced transfer.
* `a_delisted_holder_can_still_claim_their_exit`: Verifies de-listed holders always receive cash payout.
* `a_delisted_investor_can_cancel_deposit_and_receive_asset`: Verifies de-listed depositors can cancel and receive cash back.
* `a_delisted_holder_cannot_cancel_redemption_back_to_shares`: Verifies de-listed holders cannot abort redemption back into shares.
* `a_frozen_holder_cannot_cancel_redemption_back_to_shares`: Verifies frozen holders cannot abort redemption back into shares.
* `a_frozen_or_delisted_holder_cannot_transfer_shares`: Verifies secondary market transfers are strictly refused for de-listed and frozen accounts.
* `a_frozen_investor_on_the_allowlist_is_still_minted`: Records that minting does not check freezes.
* `a_frozen_holder_can_still_queue_an_exit`: Records that escrowing an exit does not check freezes.
* `queueing_an_exit_releases_a_partial_freeze`: Records that the escrow releases as much of a partial freeze as it needs.
