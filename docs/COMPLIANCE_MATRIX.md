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
   - A frozen investor is outside the payable-claims guarantee (design document §8.1). The vault asks the share token whether the address is frozen on `request_deposit`, `claim_deposit` and `cancel_redeem`: it refuses a frozen address's deposit request, and holds its priced deposit and escrowed redemption until the freeze is lifted (`Frozen`, 6071). Its other exits do not check freezes yet, so they still go through; the kit does not promise them.

---

## 2. Operation Matrix

| Operation | Allowlisted | De-listed (Non-Frozen) | Frozen (Address or Partial) | Contract Mechanics & Regulatory Rationale |
|---|---|---|---|---|
| **`request_deposit`** | ✅ Allowed | ❌ **Refused** | ❌ **Refused** | Before any cash moves, the vault asks the share token whether the address is frozen and then asks the token's identity verifier. It refuses a frozen address (`Frozen`) and an address the token would not let hold shares (`NotAllowlisted`). A partial freeze is not checked. |
| **`cancel_deposit`** | ✅ Allowed | ✅ **Allowed** | ✅ **Allowed** | **Escape Hatch**: Calls `refund_deposit`. Escrowed settlement asset (USDC) is refunded directly to `controller`. Cash refunds bypass share token compliance checks. |
| **`claim_deposit`** | ✅ Allowed | ↪ **Moved to the exit queue** | ⛔ **Held** | A receiver off the allowlist gets no shares: the vault mints them into its own escrow and adds them to the holder's redemption in the open epoch (`DepositConvertedToExit`), paid in cash at that epoch's price. In a wind-down they join the holder's wind-down entitlement. A compliance module that refuses the mint (`can_create`) still blocks the claim. A receiver whose address is frozen, listed or not, is refused with `Frozen` (6071) and keeps the priced deposit until the freeze is lifted. A partial freeze is not checked. |
| **`request_redeem`** | ✅ Allowed | ✅ **Allowed** | ⚠️ Allowed, not guaranteed | **Exit Right**: the vault escrows the shares with `RWATokenClient::forced_transfer`, which checks neither the allowlist nor freezes, so a de-listed holder can start an exit. It also releases as much of a partial freeze as the escrow needs. |
| **`cancel_redeem`** | ✅ Allowed | ❌ **Refused**; ↪ **surrendered** in a wind-down | ⛔ **Held** | Outside a wind-down the vault refuses a de-listed controller (`NotAllowlisted`) and holds one whose address is frozen (`Frozen`); anyone else gets the shares back through the token's checked `transfer`. That transfer is refused with `EnforcedPause` while the share-token transfer pause is active; the request stays pending until the pause is lifted or the epoch prices. In an active wind-down no shares come back: the escrow is burned into the controller's wind-down entitlement (`RedemptionSurrendered`), allowlisted or not, so no token pause can hold it. A frozen controller's escrow stays until the freeze is lifted. |
| **`claim_redeem`** | ✅ Allowed | ✅ **Allowed** | ⚠️ Pays, not guaranteed | **Exit-Only Cash Path**: the settlement asset pays out from the liquid reserve and the escrowed shares are burned from the vault. The cash claim checks neither the allowlist nor freezes. |
| **`transfer`** (Secondary) | ✅ Allowed | ❌ **Refused** | ❌ **Refused** | Standard peer-to-peer share transfer via SEP-57. Requires both sender and receiver to be allowlisted and neither to be frozen. |

---

## 3. Deep Dive into Key Lifecycle Invariants

### 3.1 The Exit-Only Cash Path
A core guarantee of the Strata Vault Kit is that **a de-listed, non-frozen investor can always leave the fund in cash**. A frozen investor is outside this guarantee, as the design document states in §8.1: the cash claim does not check freezes today, so their exit goes through, but nothing promises it.

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

### 3.3 De-Listing Between Pricing and Claim
If an investor deposits while allowlisted but is de-listed after the epoch is priced:
- **The cash is no longer escrow.** Pricing moved it out of the cancellable bucket into the reserve, where it backs the shares the epoch promised. The investor's claim is to those shares, counted in `pending_mint_shares`.
- **`claim_deposit` moves the shares to the exit queue.** The share token would refuse to mint to her, so the vault mints the shares into its own escrow and adds them to her redemption in the open epoch. She is paid in cash at that epoch's price, like anyone leaving then, through `claim_redeem`. A fall in the price since her deposit was priced is hers, as it would be for any holder who exits.
- **`cancel_deposit` is refused** with `AlreadyPriced`: once an epoch has a price, cancellation is closed.
- **In a wind-down**, which prices nothing further, the shares join her wind-down entitlement and `claim_wind_down` pays them.
- **In a wind-down, cancelling any escrowed redemption**, whether from her converted deposit or one she requested before the delisting, burns the escrow into the holder's wind-down entitlement (`RedemptionSurrendered`). No shares come back, for any holder.
- **The conversion needs the vault's own allowlist place**, because the vault mints the shares into its own escrow. If compliance removes the vault's address, her conversion waits until the vault is relisted. Nothing is lost.
- **Relisting first** still works: if compliance re-allowlists her before she claims, `claim_deposit` mints the shares to her.
- **A freeze holds her.** If she is also frozen, `claim_deposit` fails with `Frozen` (6071) and the priced deposit stays unclaimed until the freeze is lifted.

An address that was never allowlisted cannot reach this state: `request_deposit` refuses it before any cash moves.

### 3.4 Redemption Cancellation Refusal
When an investor requests redemption, their shares are transferred to the vault.
If the investor becomes de-listed or frozen before pricing:
- Calling `cancel_redeem` would transfer shares from the vault back to the investor's account (`return_shares`).
- The vault asks the share token first and refuses a receiver off the allowlist (`NotAllowlisted`) or holds a frozen one (`Frozen`), so returning the shares is refused.
- The investor is not allowed to re-enter share possession. They remain in the queue and exit into cash upon epoch fulfillment.
- In an active wind-down nothing is priced again, so a de-listed investor's cancel burns the escrow into their wind-down entitlement instead. A frozen investor's escrow stays until the freeze is lifted.

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

* `an_investor_who_was_never_allowlisted_is_refused_before_any_cash_moves`: Verifies a non-allowlisted depositor is refused and nothing moves.
* `a_delisted_investor_cannot_request_a_deposit`: Verifies a de-listed depositor is refused at request time.
* `relisting_after_pricing_lets_the_claim_through`: Verifies KYC restoration unblocks a priced claim.
* `a_delisted_holders_priced_deposit_joins_their_redemption_in_the_open_epoch`, `the_delisted_holder_is_paid_at_the_next_epochs_price`, `in_a_wind_down_the_shares_are_credited_before_the_first_round`, `a_conversion_caught_by_a_wind_down_is_paid_from_the_rounds`, `a_frozen_and_delisted_holders_claim_is_held`: Verify the exit path for a holder delisted after pricing ([`test/delisted.rs`](../contracts/async-vault/src/test/delisted.rs)).
* `a_holder_delisted_after_pricing_is_paid_through_a_wind_down`: The combined case, with the cancel refused as `AlreadyPriced` ([`test/compliance.rs`](../contracts/async-vault/src/test/compliance.rs)).
* `a_compliance_module_that_refuses_the_mint_blocks_a_priced_claim`: Records that a compliance module can block a priced claim (a trust assumption).
* `a_delisted_holder_can_still_queue_an_exit`: Verifies de-listed holders can queue redemption via forced transfer.
* `a_delisted_holder_can_still_claim_their_exit`: Verifies de-listed holders always receive cash payout.
* `a_delisted_investor_can_cancel_deposit_and_receive_asset`: Verifies de-listed depositors can cancel and receive cash back.
* `a_delisted_holder_cannot_cancel_redemption_back_to_shares`: Verifies de-listed holders cannot abort redemption back into shares.
* `a_frozen_holder_cannot_cancel_redemption_back_to_shares`: Verifies frozen holders cannot abort redemption back into shares.
* `a_frozen_or_delisted_holder_cannot_transfer_shares`: Verifies secondary market transfers are strictly refused for de-listed and frozen accounts.
* `a_frozen_investor_cannot_request_a_deposit`: Verifies a frozen depositor is refused at request time.
* `a_frozen_investor_is_not_minted_until_unfrozen`: Verifies a frozen investor's priced deposit is held until the freeze is lifted.
* `a_frozen_holder_can_still_queue_an_exit`: Records that escrowing an exit does not check freezes.
* `queueing_an_exit_releases_a_partial_freeze`: Records that the escrow releases as much of a partial freeze as it needs.
