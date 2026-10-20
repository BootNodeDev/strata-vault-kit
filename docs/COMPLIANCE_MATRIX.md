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
   - What the vault owes a frozen investor is **held**: not paid, not returned, not moved. Priced cash stays in `committed` and a wind-down slice stays in `wind_down_owed`, where no other holder can take it; only an unfreeze releases it. A refund for a deposit priced at zero shares is the exception: it is not tracked as owed, so it waits in the free reserve, where treasury can deploy it or a wind-down round can credit it to other holders (see the limits in the design doc's [§8.7](./strata-product-and-architecture.md#87-treasury-and-custodian)). A legal-order transfer (`legal_transfer`), which compliance and governance sign together, can move shares in the investor's own wallet, but not value the vault holds for them: deposit escrow, priced but unminted shares, shares escrowed in a redemption, priced cash, or a wind-down slice. A partial freeze limits exits to the free balance.

     This follows how asset-freeze and blocking rules generally treat frozen property: held, not released, not returned to the owner and not confiscated, with the entitlement kept and recorded. It is not legal advice; counsel must confirm it for each jurisdiction.

---

## 2. Operation Matrix

| Operation | Allowlisted | De-listed (Non-Frozen) | Frozen (Address or Partial) | Contract Mechanics & Regulatory Rationale |
|---|---|---|---|---|
| **`request_deposit`** | ✅ Allowed | ❌ **Refused** | ❌ **Refused** | Before any cash moves, the vault asks the share token whether the address is frozen and then asks the token's identity verifier. It refuses a frozen address (`Frozen`) and an address the token would not let hold shares (`NotAllowlisted`). A partial freeze is not checked. |
| **`cancel_deposit`** | ✅ Allowed | ✅ **Allowed** | ❌ **Refused** (`Frozen`); the escrow stays | **Escape Hatch**: Calls `refund_deposit`. Escrowed settlement asset (USDC) is refunded directly to `holder`. The vault checks `is_frozen` on the share token before it refunds anything; once past that, cash refunds bypass share token compliance checks. A partial freeze is not checked. |
| **`claim_deposit`** | ✅ Allowed | ↪ **Moved to the exit queue** | ⛔ **Held** | A receiver off the allowlist gets no shares: the vault mints them into its own escrow and adds them to the holder's redemption in the open epoch (`DepositConvertedToExit`), paid in cash at that epoch's price. In a wind-down they join the holder's wind-down entitlement. A compliance module that refuses the mint (`can_create`) still blocks the claim. A receiver whose address is frozen, listed or not, is refused with `Frozen` (6071) and keeps the priced deposit until the freeze is lifted. A partial freeze is not checked. |
| **`request_redeem`** | ✅ Allowed | ✅ **Allowed** | ❌ **Refused** (`Frozen`); a partial freeze caps the request to the free balance | **Exit Right**: the vault checks `is_frozen` and `get_frozen_tokens` on the share token before it escrows anything with `RWATokenClient::forced_transfer`. A de-listed, non-frozen holder can still start an exit; a frozen one cannot, and a partial freeze caps the request to the shares `get_frozen_tokens` leaves free. |
| **`cancel_redeem`** | ✅ Allowed | ❌ **Refused**; ↪ **surrendered** in a wind-down | ⛔ **Held**; a partial freeze does not stop it: the shares return and stay partly frozen | Outside a wind-down the vault refuses a de-listed holder (`NotAllowlisted`) and holds one whose address is frozen (`Frozen`). For anyone else it checks the receiver itself (passes the identity check, not frozen, accepted by the compliance rules' `can_transfer`) and returns the shares with the manager `forced_transfer`; a move the rules refuse gets `HolderNotEligible`. Neither the vault's own allowlist place nor the share-token pause stops a return. A refused holder stays in the queue and exits in cash once the epoch is priced. In an active wind-down no shares come back: the escrow is burned into the holder's wind-down entitlement (`RedemptionSurrendered`), allowlisted or not. A frozen holder's escrow stays until the freeze is lifted. |
| **`claim_redeem`** | ✅ Allowed | ✅ **Allowed** | ❌ **Refused** (`Frozen`); the cash stays in `committed` | **Exit-Only Cash Path**: the settlement asset pays out from the liquid reserve and the escrowed shares are burned from the vault. The cash claim checks `is_frozen` on the share token first; it does not check the allowlist. A partial freeze is not checked. Outside a wind-down, a claim that pays nothing returns the escrowed shares instead, under the same checks as `cancel_redeem`: a de-listed holder's is refused with `HolderNotEligible` and the request stays. In a wind-down such a claim burns the escrowed shares. |
| **`claim_wind_down`** | ✅ Allowed | ✅ **Allowed** | ❌ **Refused** (`Frozen`); the slice stays in `wind_down_owed` | **Wind-Down Payout**: pays the holder's pro-rata entitlement and burns the free shares it surrenders. The vault checks `is_frozen` and `get_frozen_tokens` on the share token first; a partial freeze surrenders only the free shares — the rest keeps earning every round and is paid once unfrozen. |
| **`transfer`** (Secondary) | ✅ Allowed | ❌ **Refused** | ❌ **Refused** | Standard peer-to-peer share transfer via SEP-57. Requires both sender and receiver to be allowlisted and neither to be frozen. |
| **`legal_transfer`** (compliance + governance) | ✅ Allowed | ✅ Allowed | ✅ Allowed | Moves shares in the holder's wallet under a legal order; the destination must pass `verify_identity`; never into or out of the vault. It cannot reach value the vault holds for a frozen holder; only an unfreeze releases that. |

---

## 3. Deep Dive into Key Lifecycle Invariants

### 3.1 The Exit-Only Cash Path
A core guarantee of the Strata Vault Kit is that **a de-listed, non-frozen investor can always leave the fund in cash**. A frozen investor is held instead of paid, as §1 describes.

- **Mechanism**:
  1. A de-listed holder queues an exit via `request_redeem`. The vault escrows the shares with `forced_transfer`.
  2. The epoch closes and is priced via attestation.
  3. Once priced and covered, the cash liability is committed.
  4. The investor calls `claim_redeem`. The cash payout transfers the settlement asset (USDC) directly to the investor's Stellar account, while the shares are burned from the vault's own balance.
  5. The cash transfer asks the identity verifier through `standing`, but the claim does not depend on its answer: a de-listed holder is treated the same as a listed one. It does check `ShareToken::is_frozen` first: a frozen holder's claim is held, not paid, until the freeze lifts. Once priced, covered and unfrozen, cash exits cannot be blocked.

### 3.2 Deposit Cancellation for De-Listed Investors
If an investor deposits into an open epoch but is de-listed (or KYC expires) before the epoch is priced:
- The investor is permitted to call `cancel_deposit(holder, epoch_id)`.
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
- The vault checks the holder itself before it returns escrowed shares. A de-listed holder is refused (`NotAllowlisted`), and so is a move the compliance rules refuse (`HolderNotEligible`); either way the investor stays in the queue and exits in cash once the epoch is priced. A frozen holder is held (`Frozen`) until the freeze is lifted.
- The vault moves the shares as the token's `manager` (`forced_transfer`), so removing the vault's own address from the allowlist does not stop returns. A share-token pause does not stop them either: it stops trading between holders, not the vault's escrow. A partial freeze does not stop them: the shares return and stay partly frozen.
- During a wind-down, every cancel burns the escrowed shares into the holder's wind-down entitlement (`RedemptionSurrendered`), listed or not, and they collect pro rata with `claim_wind_down`. A frozen holder's escrow stays until the freeze is lifted.

---

## 4. Where the Checks Live (OpenZeppelin `stellar-tokens` 0.7.2)

The share token is OpenZeppelin's RWA token. The allowlist and freeze checks sit in the token's own operations, not in compliance hooks:

| Token operation | Freeze check | Allowlist check (`verify_identity`) | Compliance hooks |
|---|---|---|---|
| `transfer` | Refuses if sender or receiver is frozen; the sender needs enough unfrozen balance | Sender and receiver | `can_transfer` before, `transferred` after |
| `mint` | None | Receiver | `can_create` before, `created` after |
| `forced_transfer` | None; releases as much of a partial freeze as the amount needs | None | `transferred` after |
| `legal_transfer` (the kit's own, built on `forced_transfer`) | None; releases as much of a partial freeze as the amount needs | Receiver | `transferred` after |
| `burn` | None; releases as much of a partial freeze as the amount needs | None | `destroyed` after |

0.7.2 has five compliance hooks: `can_transfer` and `can_create` are asked before the state change, and `transferred`, `created` and `destroyed` are told after it. There is no `can_destroy`.

When the vault returns escrowed shares with `forced_transfer`, it makes the receiver checks itself first: the freeze, `verify_identity` and `can_transfer`. It does not check the token pause.

The kit's compliance contract registers no modules, so `can_transfer` and `can_create` always allow today. Until rule modules are added, the allowlist and freeze rules are exactly the token checks in the table above. Adding or removing a module waits for the vault's timelock once its setup is finished, so holders get at least the delay as notice of a rule change. An exit still needs a sealed epoch, a price and cash, so the delay does not promise that one completes first.

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
* `share_returns::*` ([`test/share_returns.rs`](../contracts/async-vault/src/test/share_returns.rs)): Verifies a cancel returns the shares while the vault's own address is delisted or the token is paused, keeps a partial freeze on the returned shares, and refuses a move the compliance rules refuse or a delisted holder's zero-asset claim with `HolderNotEligible`.
* `a_frozen_holder_is_paid_only_after_the_freeze_lifts`: Verifies a frozen holder's cancel and claim are both held, and paid only once the freeze lifts.
* `a_frozen_or_delisted_holder_cannot_transfer_shares`: Verifies secondary market transfers are strictly refused for de-listed and frozen accounts.
* `a_frozen_investor_cannot_request_a_deposit`: Verifies a frozen depositor is refused at request time.
* `a_frozen_investor_is_not_minted_until_unfrozen`: Verifies a frozen investor's priced deposit is held until the freeze is lifted.
* `a_frozen_holder_cannot_queue_an_exit`: Verifies a frozen holder cannot start a redemption.
* `a_partial_freeze_limits_an_exit_to_the_free_shares`: Verifies a partial freeze caps a redemption request to the free balance.
* `a_frozen_investors_escrow_stays_until_the_freeze_lifts`: Verifies a frozen depositor's cancel is held and the escrow is unaffected.
* `a_frozen_holder_does_not_get_a_worthless_exit_back`: Verifies a frozen holder's zero-asset claim is held rather than returning shares.
* `a_frozen_holder_is_not_moved_into_the_exit_queue`: Verifies a holder who is both de-listed and frozen is held, not converted to an exit.
* `a_frozen_holders_slice_stays_owed_until_the_freeze_lifts` ([`test/wind_down.rs`](../contracts/async-vault/src/test/wind_down.rs)): Verifies a frozen holder's wind-down slice stays in `wind_down_owed` until the freeze lifts.
* `a_frozen_holders_escrowed_exit_waits_through_a_wind_down`: Verifies a frozen holder's escrowed redemption and wind-down claim are both held through a wind-down.
* `a_partial_freeze_keeps_frozen_shares_out_of_a_wind_down_claim`: Verifies a partial freeze excludes frozen shares from a wind-down surrender.
* `legal_transfer::*` ([`contracts/share-token/src/test.rs`](../contracts/share-token/src/test.rs)): Verifies a legal-order transfer needs compliance and governance as two different accounts, never moves shares out of or into the vault's address, lands only on an allowlisted account and publishes its order reference; recovery needs the same co-signature, and the vault's address cannot be frozen.
