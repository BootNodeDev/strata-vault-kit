# Compliance & Freeze Matrix Across Vault Lifecycle

This document is the authoritative specification of identity, allowlist, and freeze behavior across all Strata vault lifecycle operations. It consolidates architectural decisions (#48, #94) and formally defines the interaction between the asynchronous vault, the SEP-57 compliant share token, and the on-chain identity verifier.

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
   - Share transfers and mints to/from this account are strictly blocked by SEP-57 compliance hooks.
   - Forced transfers to the vault manager for redemption remain open, and cash payouts remain covered.

---

## 2. Operation Matrix

| Operation | Allowlisted | De-listed (Non-Frozen) | Frozen (Address or Partial) | Contract Mechanics & Regulatory Rationale |
|---|---|---|---|---|
| **`request_deposit`** | ✅ Allowed | ⚠️ Allowed by SAC | ⚠️ Allowed by SAC | SAC USDC transfer moves funds into cancellable escrow. The vault does not check `IdentityVerifier` at subscription time to avoid coupling to external registry gas or third-party downtime. |
| **`cancel_deposit`** | ✅ Allowed | ✅ **Allowed** | ✅ **Allowed** | **Escape Hatch**: Calls `refund_deposit`. Escrowed settlement asset (USDC) is refunded directly to `controller`. Cash refunds bypass share token compliance checks. |
| **`claim_deposit`** | ✅ Allowed | ❌ **Refused** | ❌ **Refused** | `ShareClient::mint` executes SEP-57 compliance hook `can_create`. Reverts with `IdentityVerificationFailed` or `AddressFrozen`. Shares are never minted to unallowlisted entities. |
| **`request_redeem`** | ✅ Allowed | ✅ **Allowed** | ✅ **Allowed** | **Exit Right**: Shares are escrowed via `ShareClient::forced_transfer` by the vault manager, bypassing freeze and allowlist checks to ensure non-compliant holders can initiate exit. |
| **`cancel_redeem`** | ✅ Allowed | ❌ **Refused** | ❌ **Refused** | `return_shares` uses standard `ShareClient::transfer(vault, controller, shares)`, which executes `can_transfer`. Reverts if `controller` is de-listed or frozen. Holder cannot re-acquire shares. |
| **`claim_redeem`** | ✅ Allowed | ✅ **Allowed** | ✅ **Allowed** | **Exit-Only Cash Path**: Settlement asset pays out directly from vault liquid reserve; shares were already burned or escrowed. Cash claim is never identity-gated. |
| **`transfer`** (Secondary) | ✅ Allowed | ❌ **Refused** | ❌ **Refused** | Standard peer-to-peer share transfer via SEP-57. Requires both sender and receiver to be allowlisted, and sender not frozen. |

---

## 3. Deep Dive into Key Lifecycle Invariants

### 3.1 The Exit-Only Cash Path
A core regulatory guarantee of the Strata Vault Kit is that **an investor who has had their allowlist status revoked or frozen can always leave the fund in cash**.

- **Mechanism**:
  1. A de-listed holder queues an exit via `request_redeem`. The vault manager executes a `forced_transfer` to escrow the shares in the vault.
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
- **`claim_deposit` is refused**: The vault calls `ShareClient::mint`, which evaluates `can_create`. Because the receiver is no longer allowlisted, the transaction reverts with `IdentityVerificationFailed`.
- **`cancel_deposit` is blocked**: The epoch is already `Fulfilled`. As an anti-arbitrage safeguard, once an epoch has taken a valuation, cancellation is permanently closed (`VaultError::AlreadyPriced`).
- **Resolution**: The investor's settlement capital remains safely in vault escrow. The investor can either:
  1. Complete KYC refresh, upon which compliance re-allowlists the account and `claim_deposit` succeeds; or
  2. Compliance / governance resolves the claim out-of-band.

### 3.4 Redemption Cancellation Refusal
When an investor requests redemption, their shares are transferred to the vault.
If the investor becomes de-listed or frozen before pricing:
- Calling `cancel_redeem` requires transferring shares from the vault back to the investor's account (`return_shares`).
- `ShareToken::transfer` verifies receiver compliance. Since the investor is no longer allowed or is frozen, returning shares is **strictly refused**.
- The investor is not allowed to re-enter share possession. They remain in the queue and exit into cash upon epoch fulfillment.

---

## 4. SEP-57 Compliance Hook Verification

The share token conforms to SEP-57 and the OpenZeppelin RWA token standard:

```
                    ┌─────────────────────────┐
                    │       ShareToken        │
                    └────────────┬────────────┘
                                 │
                 ┌───────────────┴───────────────┐
                 ▼                               ▼
       ┌───────────────────┐           ┌───────────────────┐
       │   can_transfer    │           │    can_create     │
       └─────────┬─────────┘           └─────────┬─────────┘
                 │                               │
                 ▼                               ▼
  ┌─────────────────────────────┐  ┌─────────────────────────────┐
  │ Sender & Receiver Allowed   │  │ Receiver Allowed            │
  │ Sender Not Frozen           │  │ Receiver Not Frozen         │
  └─────────────────────────────┘  └─────────────────────────────┘
```

1. **`can_transfer(from, to, amount)`**:
   - `IdentityVerifier::is_allowed(from) == true`
   - `IdentityVerifier::is_allowed(to) == true`
   - `ShareToken::is_frozen(from) == false`
   - `ShareToken::is_frozen(to) == false` (or receiver not frozen)
2. **`can_create(to, amount)`**:
   - `IdentityVerifier::is_allowed(to) == true`
   - `ShareToken::is_frozen(to) == false`
3. **`can_destroy(from, amount)`**:
   - Executed during redemption claim. Burn occurs from the vault contract address, which holds the manager role and is an approved entity.

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
