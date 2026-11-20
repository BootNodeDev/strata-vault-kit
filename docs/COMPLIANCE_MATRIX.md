# Compliance & Freeze Matrix Across Vault Lifecycle

This document is the authoritative specification of identity, listing and freeze behavior across all Strata vault lifecycle operations. It formally defines the interaction between the asynchronous vault, the SEP-57 compliant share token, the kit's identity contracts (registry, verifier, topics, claim issuer) and its compliance contract. The design doc's [§8.6](./strata-product-and-architecture.md#86-identity-and-compliance) describes those contracts.

---

## 1. Investor States

Every investor account in the vault ecosystem exists in one of four compliance states. The vault reads the first three from the identity verifier's answer to `verify_identity(account)`, and the fourth from the share token:

1. **Verified (`Listed`)**:
   - The verifier passes the account: the identity registry links it to a kit identity holding a valid claim from a trusted issuer for every required topic.
   - The account is not subject to sanctions or administrative freezes (`is_frozen(account) == false`).
   - Full access to all protocol features (subscriptions, secondary transfers, cancellations, redemptions).

2. **De-listed / Non-Frozen (`Delisted`)**:
   - The verifier refuses the account, with OpenZeppelin's `IdentityNotFound` (321) or `IdentityVerificationFailed` (304). The wallet never onboarded, or the compliance authority delisted and vetoed it, or a required claim expired, was revoked or was invalidated by its provider.
   - The account is **not** frozen under court order or regulatory sanctions (`is_frozen(account) == false`).
   - The account may not acquire or receive new shares, but **must be permitted to exit into cash**.

3. **Unverifiable (`Unverifiable`)**:
   - The verifier fails with `Unavailable` (10002): a contract its answer depends on (the registry, the topics contract, the identity or an issuer) failed, and no required topic refused the account.
   - A fault lets no one in and pushes no one out. Wherever a verified and a de-listed holder part ways, an unverifiable holder waits (`VerifierFailed`) and keeps their place. A wind-down is the exception: it reads the fault as a refusal, because a faulty issuer could otherwise hold a deposit open for good.

4. **Frozen (`Frozen`)**:
   - The account is subject to sanctions, legal freezing, or security hold (`is_frozen(account) == true` via `ShareToken::set_address_frozen`).
   - The share token refuses a `transfer` from or to a frozen address, and a mint to one (`AddressFrozen`). `forced_transfer` ignores freezes.
   - What the vault owes a frozen investor is **held**: not paid, not returned, not moved. Priced cash stays in `committed` and a wind-down slice stays in `wind_down_owed`, where no other holder can take it; only an unfreeze releases it. Lifting a freeze needs a holder of the share token's `compliance` role, so a frozen investor's wind-down slice waits for one to be live: the last holder cannot renounce, and a grant of the role passes the token's timelock even during a wind-down. A refund for a deposit priced at zero shares is the exception: it is not tracked as owed, so it waits in the free reserve, where treasury can deploy it or a wind-down round can credit it to other holders (see the limits in the design doc's [§8.7](./strata-product-and-architecture.md#87-treasury-and-custodian)). A legal-order transfer (`legal_transfer`), which compliance and governance sign together, can move shares in the investor's own wallet, but not value the vault holds for them: deposit escrow, priced but unminted shares, shares escrowed in a redemption, priced cash, or a wind-down slice. A partial freeze limits exits to the free balance.

     This follows how asset-freeze and blocking rules generally treat frozen property: held, not released, not returned to the owner and not confiscated, with the entitlement kept and recorded. It is not legal advice; counsel must confirm it for each jurisdiction.

---

## 2. Operation Matrix

| Operation | Verified | De-listed (Non-Frozen) | Unverifiable (verifier fault) | Frozen (Address or Partial) | Contract Mechanics & Regulatory Rationale |
|---|---|---|---|---|---|
| **`request_deposit`** | ✅ Allowed | ❌ **Refused** (`NotAllowlisted`) | ❌ **Refused** (`VerifierFailed`) | ❌ **Refused** | Before any cash moves, the vault asks the share token whether the address is frozen and then asks the token's identity verifier. It refuses a frozen address (`Frozen`), an address the verifier refuses (`NotAllowlisted`) and one the verifier fails on (`VerifierFailed`). A partial freeze is not checked. |
| **`cancel_deposit`** | ✅ Allowed | ✅ **Allowed** | ✅ **Allowed** | ❌ **Refused** (`Frozen`); the escrow stays | **Escape Hatch**: Calls `return_escrow`, then publishes `DepositCancelled`. Escrowed settlement asset (USDC) is refunded directly to `holder`. The vault checks `is_frozen` on the share token before it refunds anything; once past that, cash refunds bypass share token compliance checks. A partial freeze is not checked. |
| **`claim_deposit`** | ✅ Allowed | ↪ **Moved to the exit queue** | ⏸ **Waits** (`VerifierFailed`); ↪ **surrendered** in a wind-down | ⛔ **Held** | A receiver the verifier refuses gets no shares: the vault mints them into its own escrow and adds them to the holder's redemption in the open epoch (`DepositConvertedToExit`), paid in cash at that epoch's price. In a wind-down they join the holder's wind-down entitlement. A receiver the verifier fails on is refused with `VerifierFailed`: nothing moves and the request stays open for a retry, outside a wind-down; in a wind-down the fault counts as a refusal and the shares join the entitlement. A deposit priced at zero shares is refunded whatever the verifier says. A compliance module that refuses the mint to the holder (on the `Created` hook) still blocks the claim; one that refuses the conversion's mint into the vault does not (§4). A receiver whose address is frozen, listed or not, is refused with `Frozen` (6071) and keeps the priced deposit until the freeze is lifted. A partial freeze is not checked. |
| **`request_redeem`** | ✅ Allowed | ✅ **Allowed** | ✅ **Allowed** | ❌ **Refused** (`Frozen`); a partial freeze caps the request to the free balance | **Exit Right**: the vault checks `is_frozen` and `get_frozen_tokens` on the share token before it escrows anything with `RWATokenClient::forced_transfer`. A de-listed or unverifiable, non-frozen holder can still start an exit; a frozen one cannot, and a partial freeze caps the request to the shares `get_frozen_tokens` leaves free. The token checks the vault as the receiver of that move, and the kit's verifier always passes its bound vault, so no listing action stops a request. Compliance modules see the move as `TransferKind::Forced`, and the kit's compliance contract ignores a module that refuses it (§4). |
| **`cancel_redeem`** | ✅ Allowed | ❌ **Refused**; ↪ **surrendered** in a wind-down | ❌ **Refused** (`VerifierFailed`); ↪ **surrendered** in a wind-down | ⛔ **Held**; a partial freeze does not stop it: the shares return and stay partly frozen | Outside a wind-down the vault refuses a de-listed holder (`NotAllowlisted`), refuses one the verifier fails on (`VerifierFailed`) and holds one whose address is frozen (`Frozen`). For anyone else it checks the receiver itself (passes the identity check, not frozen), then returns the shares with the manager `forced_transfer`; a move that fails, as when a compliance module refuses it, gets `HolderNotEligible`. Neither the vault's own listing nor the share-token pause stops a return. A refused holder stays in the queue and exits in cash once the epoch is priced. In an active wind-down no shares come back: the escrow is burned into the holder's wind-down entitlement (`RedemptionSurrendered`), listed or not. A frozen holder's escrow stays until the freeze is lifted. |
| **`claim_redeem`** | ✅ Allowed | ✅ **Allowed** | ✅ **Allowed**; a zero-asset claim waits (`VerifierFailed`) | ❌ **Refused** (`Frozen`); the cash stays in `committed` | **Exit-Only Cash Path**: the settlement asset pays out from the liquid reserve and the escrowed shares are burned from the vault. The cash claim checks `is_frozen` on the share token first; it does not depend on the verifier's answer. A partial freeze is not checked. Outside a wind-down, a claim that pays nothing returns the escrowed shares instead, to a holder who passes the same checks as `cancel_redeem`. For a de-listed holder, or a return that fails, and always in a wind-down, such a claim burns the escrowed shares (`RedeemClaimed` with zero assets), so the request settles. From the identity verifier only an answer burns them: if it fails instead of answering, the claim fails (`VerifierFailed`) and the request waits for a retry. A compliance module that fails on the return cannot be told from one that refuses, since modules refuse by panicking, so its failure burns them too. No module can stop the burn (§4). |
| **`claim_wind_down`** | ✅ Allowed | ✅ **Allowed** | ✅ **Allowed** | ❌ **Refused** (`Frozen`); the slice stays in `wind_down_owed` | **Wind-Down Payout**: pays the holder's pro-rata entitlement and burns the free shares it surrenders. The vault checks `is_frozen` and `get_frozen_tokens` on the share token first; a partial freeze surrenders only the free shares — the rest keeps earning every round and is paid once unfrozen. No module can stop the burn (§4). |
| **`transfer`** (Secondary) | ✅ Allowed | ❌ **Refused** | ❌ **Refused** (the verifier's `Unavailable`) | ❌ **Refused** | Standard peer-to-peer share transfer via SEP-57. Requires both sender and receiver to pass the identity verifier and neither to be frozen, never to the vault's address (`VaultAddress`). |
| **`legal_transfer`** (compliance + governance) | ✅ Allowed | ✅ Allowed | ✅ Allowed | ✅ Allowed | Moves shares in the holder's wallet under a legal order; the destination must pass `verify_identity`; never into or out of the vault. It cannot reach value the vault holds for a frozen holder; only an unfreeze releases that. |

---

## 3. Deep Dive into Key Lifecycle Invariants

### 3.1 The Exit-Only Cash Path
A core guarantee of the Strata Vault Kit is that **a de-listed, non-frozen investor can always leave the fund in cash**. A frozen investor is held instead of paid, as §1 describes. No listing action stops it: the kit's verifier passes the bound vault as a protocol address, which cannot be removed, so the vault's own escrow moves never depend on the vault's listing.

- **Mechanism**:
  1. A de-listed holder queues an exit via `request_redeem`. The vault escrows the shares with `forced_transfer`. The token checks the vault's identity as the receiver, and the verifier passes the vault without reading claims. The kit's compliance contract ignores a module that refuses this move (§4).
  2. The epoch closes and is priced via attestation.
  3. Once priced and covered, the cash liability is committed.
  4. The investor calls `claim_redeem`. The cash payout transfers the settlement asset (USDC) directly to the investor's Stellar account, while the shares are burned from the vault's own balance; no module can stop that burn (§4).
  5. The cash transfer asks the identity verifier through `standing`, but the claim does not depend on its answer: a de-listed or unverifiable holder is treated the same as a listed one. It does check `ShareToken::is_frozen` first: a frozen holder's claim is held, not paid, until the freeze lifts. Once priced, covered and unfrozen, cash exits cannot be blocked.

### 3.2 Deposit Cancellation for De-Listed Investors
If an investor deposits into an open epoch but is de-listed (or a claim expires) before the epoch is priced:
- The investor is permitted to call `cancel_deposit(holder, epoch_id)`.
- `return_escrow` transfers the escrowed USDC back to the investor.
- Because no shares were minted, returning cash restores the investor's funds without violating share token compliance rules.

### 3.3 De-Listing Between Pricing and Claim
If an investor deposits while verified but is de-listed after the epoch is priced:
- **The cash is no longer escrow.** Pricing moved it out of the cancellable bucket into the reserve, where it backs the shares the epoch promised. The investor's claim is to those shares, counted in `pending_mint_shares`.
- **`claim_deposit` moves the shares to the exit queue.** The share token would refuse to mint to her, so the vault mints the shares into its own escrow and adds them to her redemption in the open epoch. She is paid in cash at that epoch's price, like anyone leaving then, through `claim_redeem`. A fall in the price since her deposit was priced is hers, as it would be for any holder who exits.
- **`cancel_deposit` is refused** with `AlreadyPriced`: once an epoch has a price, cancellation is closed.
- **In a wind-down**, which prices nothing further, the shares join her wind-down entitlement and `claim_wind_down` pays them.
- **In a wind-down, cancelling any escrowed redemption**, whether from her converted deposit or one she requested before the delisting, burns the escrow into the holder's wind-down entitlement (`RedemptionSurrendered`). No shares come back, for any holder.
- **The conversion does not depend on the vault's own listing.** The vault mints the shares into its own escrow, the token checks the vault as the receiver, and the kit's verifier passes the vault as a protocol address. A compliance module that refuses that mint is ignored (§4).
- **Passing again first** still works: if she renews the claim on her identity, or the compliance authority lifts her veto and she onboards again, before she claims, `claim_deposit` mints the shares to her.
- **A verifier fault is not a delisting.** If the verifier fails instead of answering, `claim_deposit` is refused with `VerifierFailed` and nothing moves; she claims again once the verifier answers. In a wind-down the fault counts as a refusal, and the shares join her wind-down entitlement.
- **A freeze holds her.** If she is also frozen, `claim_deposit` fails with `Frozen` (6071) and the priced deposit stays unclaimed until the freeze is lifted.

An address that was never verified cannot reach this state: `request_deposit` refuses it before any cash moves.

### 3.4 Redemption Cancellation Refusal
When an investor requests redemption, their shares are transferred to the vault.
If the investor becomes de-listed or frozen before pricing:
- The vault checks the holder itself before it returns escrowed shares. A de-listed holder is refused (`NotAllowlisted`), a holder the verifier fails on is refused (`VerifierFailed`), and so is a return that fails, as when a compliance module refuses it (`HolderNotEligible`); either way the investor stays in the queue and exits in cash once the epoch is priced. If that price pays nothing, the claim burns the escrowed shares, since the holder still cannot take them back. A frozen holder is held (`Frozen`) until the freeze is lifted.
- The vault moves the shares as the token's `manager` (`forced_transfer`), and the token checks only the holder as the receiver, so the vault's own listing does not matter to returns. A share-token pause does not stop them either: it stops trading between holders, not the vault's escrow. A partial freeze does not stop them: the shares return and stay partly frozen.
- During a wind-down, every cancel burns the escrowed shares into the holder's wind-down entitlement (`RedemptionSurrendered`), listed or not, and they collect pro rata with `claim_wind_down`. A frozen holder's escrow stays until the freeze is lifted.

### 3.5 Onboarding, Delisting and the Veto
How an account moves between the states of §1:
- **Onboarding (to Verified).** The investor passes KYC with a provider off-chain. The provider signs a claim for each required topic, addressed to the identity the registry will deploy (`identity_address(wallet)`). The investor calls `onboard` on the identity registry, signing and paying for it. In one transaction the registry deploys the identity, adds the claims (each issuer checks its claim as it is added), asks the verifier's `check_claims` and links the wallet (`IdentityRegistered`). If any claim fails, nothing is kept. A wallet that already owns a kit identity, from another fund for example, links it with `attach` instead.
- **Renewing a claim.** A linked investor adds a new claim to their identity directly, before or after the old one expires. The link does not change. Between expiry and renewal the account is de-listed.
- **A claim ends (to De-listed).** The claim expires, or its provider revokes it or invalidates every claim of that identity on that topic. The registry still links the wallet, but the verifier refuses it with 304.
- **Delisting (to De-listed).** The compliance authority calls `remove_identity` on the registry. It unlinks the wallet and vetoes it in one call, at once, even during a wind-down (`IdentityRemoved`, `VetoSet`). It can veto a wallet that never onboarded, to block it in advance.
- **The veto.** A vetoed wallet cannot link itself again: `onboard` and `attach` refuse it (`Vetoed`), and so does the compliance authority's own `add_identity`. Only the compliance authority lifts a veto (`lift_veto`, `VetoSet` with `vetoed` false). Lifting does not relist the wallet: the investor onboards again, and `onboard` reuses the identity it deployed for that wallet before, if any.
- **Listing by the compliance authority.** `add_identity` and `batch_add_identity` link a wallet to a kit identity whose claims pass `check_claims`. The compliance authority cannot list a wallet without valid claims.
- **A lost wallet.** Recovery is not offered (`recover_identity` fails with `RecoveryNotOffered`, and the token's `recover_balance` fails because the verifier names no target). The shares move by `legal_transfer`, and the investor onboards the new wallet with a new identity and new claims.

Delisting a wallet changes nothing for the vault's own escrow moves: the verifier passes the vault as a protocol address, so even `remove_identity` on the vault's address leaves redemption requests and conversions working.

---

## 4. Where the Checks Live (OpenZeppelin `stellar-tokens` 0.8.0)

The share token is OpenZeppelin's RWA token. The identity and freeze checks sit in the token's own operations, not in compliance hooks:

| Token operation | Freeze check | Identity check (`verify_identity`) | Compliance hooks |
|---|---|---|---|
| `transfer` | Refuses if sender or receiver is frozen; the sender needs enough unfrozen balance; never to the vault's address (`VaultAddress`) | Sender and receiver | `transferred` after (`Standard`; `Delegated` for `transfer_from`) |
| `mint` | Refuses a frozen receiver (`AddressFrozen`) | Receiver | `created` after |
| `forced_transfer` | None; releases as much of a partial freeze as the amount needs | Receiver | `transferred` after (`Forced`) |
| `legal_transfer` (the kit's own, built on `forced_transfer`) | None; releases as much of a partial freeze as the amount needs | Receiver | `transferred` after (`Forced`) |
| `burn` | None; releases as much of a partial freeze as the amount needs | None | `destroyed` after |

Each batch call (`batch_mint`, `batch_burn`, `batch_transfer`, `batch_forced_transfer` and the three batch freeze calls) runs the checks of its single call for every entry. `batch_transfer` also refuses the vault's address as a receiver.

0.8.0 has three compliance hooks, all called after the state change: `transferred`, `created` and `destroyed`. A module refuses by panicking, which rolls the whole call back; nothing asks the modules before the change. `transferred` tells the module the kind of move: `Standard`, `Delegated`, `Forced` (`forced_transfer` and `legal_transfer`) or `Recovery` (`recover_balance`).

**The exit rule.** Once the kit's compliance contract is bound to its vault, it still calls every module on every hook, but on three kinds of move it calls each module with `try_` and ignores a refusal or a failure:

- any move whose receiver is the bound vault, of any `TransferKind`: a redemption request's escrow, a conversion's escrow;
- a mint to the vault;
- every burn: a claim's burn of the vault's escrow, a wind-down surrender, a wind-down payout from the holder's wallet. Only the token's `manager` burns, and the vault's setup requires the vault to hold that role alone.

The modules still see these moves, so counters stay right; a module that refuses one has its own changes rolled back for that move only, and no event records the ignored refusal. Every other move runs all modules and stops at a refusal: a mint to a holder at a share claim, a share return to a holder, a transfer between holders, a legal transfer. `try_` cannot catch a module that runs the transaction out of budget or resource limits, or that hits another error the host does not recover from, such as touching a ledger entry outside the footprint: such a module still stops the move until governance removes it, which lands through the timelock even during a wind-down. The rule follows the bound vault and the `manager` role, not the token: another token bound to the same compliance contract, or a second `manager` granted after setup (both timelocked), would also skip refusals on burns and moves into the vault. An outside compliance contract has no exit rule.

When the vault returns escrowed shares with `forced_transfer`, it checks the receiver's freeze and `verify_identity` itself first. The compliance modules then judge the move as it happens. Any move that fails rolls back, and the vault reads it as "may not take the shares back", whether a module refused or failed. It does not check the token pause.

**For module authors.** The vault's escrow moves reach modules as `TransferKind::Forced`: a redemption request moves the holder's shares into the vault, and a cancel or a zero-asset claim moves them back. OpenZeppelin suggests policy modules exempt `Forced`. With this vault, a module that must restrict who receives shares must not exempt it, or a return hands shares to a holder the module would refuse. A module need not exempt moves into the vault or burns: the exit rule ignores its answer there, and it should keep its work there small, since running out of budget is the one way it can still stop an exit ([THREAT_MODEL X6](./THREAT_MODEL.md#x6-a-compliance-module-blocks-exits)). A module that fails on a return is read the same as one that refuses: the cancel gets `HolderNotEligible`, and a zero-asset claim burns the shares, a loss under one asset unit that needs the holder's own signed claim.

The kit's compliance contract registers no modules, so its hooks refuse nothing today. Until rule modules are added, the identity and freeze rules are exactly the token checks in the table above. Adding or removing a module waits for the vault's timelock once its setup is finished, so holders get at least the delay as notice of a rule change. An exit still needs a sealed epoch, a price and cash, so the delay does not promise that one completes first.

The `transfer` checks above and the token pause are the kit's two transfer modes; see [Transfer Modes](./kit-spec.md#transfer-modes).

---

## 5. Automated Test Coverage

The behavior specified in this matrix is verified by on-chain automated test suites in [`contracts/async-vault/src/test/compliance.rs`](../contracts/async-vault/src/test/compliance.rs):

* `an_investor_who_was_never_allowlisted_is_refused_before_any_cash_moves`: Verifies a depositor the verifier refuses is refused and nothing moves.
* `a_delisted_investor_cannot_request_a_deposit`: Verifies a de-listed depositor is refused at request time.
* `relisting_after_pricing_lets_the_claim_through`: Verifies that passing the identity check again unblocks a priced claim.
* `a_delisted_holders_priced_deposit_joins_their_redemption_in_the_open_epoch`, `the_delisted_holder_is_paid_at_the_next_epochs_price`, `in_a_wind_down_the_shares_are_credited_before_the_first_round`, `a_conversion_caught_by_a_wind_down_is_paid_from_the_rounds`, `a_frozen_and_delisted_holders_claim_is_held`: Verify the exit path for a holder delisted after pricing ([`test/delisted.rs`](../contracts/async-vault/src/test/delisted.rs)).
* `a_verifier_fault_for_one_holder_holds_the_priced_deposit_open`, `a_verifier_fault_for_every_address_fails_the_deposit_claim`, `in_a_wind_down_a_verifier_fault_surrenders_the_priced_deposit`: Verify that a verifier fault refuses the deposit claim with `VerifierFailed` and moves nothing, and that in a wind-down it surrenders the deposit into the payout ([`test/delisted.rs`](../contracts/async-vault/src/test/delisted.rs)).
* `identity_stack::*` ([`test/identity_stack.rs`](../contracts/async-vault/src/test/identity_stack.rs)): The same rules on the real identity stack, with an issuer whose code traps: a fault holds a priced deposit open and the claim succeeds once the issuer is fixed (`a_verifier_fault_holds_a_priced_deposit_claim_open`), a fault refuses a deposit request (`a_verifier_fault_lets_no_one_in`), still refunds a deposit worth no shares (`a_verifier_fault_still_refunds_a_deposit_worth_no_shares`), surrenders a deposit in a wind-down (`a_verifier_fault_in_a_wind_down_surrenders_the_deposit`) and keeps a redemption in escrow until it is paid (`a_verifier_fault_keeps_a_redemption_in_escrow_until_it_is_paid`); an expired claim still converts a priced deposit (`a_kyc_refusal_still_converts_a_priced_deposit`); and a redemption request works whatever the registry holds for the vault (`a_redemption_request_works_whatever_the_vault_listing`).
* `a_holder_delisted_after_pricing_is_paid_through_a_wind_down`: The combined case, with the cancel refused as `AlreadyPriced` ([`test/compliance.rs`](../contracts/async-vault/src/test/compliance.rs)).
* `a_compliance_module_that_refuses_the_mint_blocks_a_priced_claim`: Records that a compliance module refusing the mint to the holder can block a priced claim (a trust assumption).
* `a_module_refusing_burns_does_not_block_a_redemption_claim`, `a_module_refusing_mints_does_not_block_a_conversion_to_an_exit`: Verify the exit rule from the vault's side; `a_module_refusing_returns_still_blocks_a_cancellation` ([`test/share_returns.rs`](../contracts/async-vault/src/test/share_returns.rs)) shows that a share return is not exempt. The rule itself is tested in [`contracts/compliance/src/test/exit_rule.rs`](../contracts/compliance/src/test/exit_rule.rs).
* Onboarding and the veto are tested in [`contracts/identity-registry/src/test/onboarding.rs`](../contracts/identity-registry/src/test/onboarding.rs) and [`platform.rs`](../contracts/identity-registry/src/test/platform.rs): `removal_vetoes_and_a_vetoed_wallet_cannot_onboard_or_attach`, `only_compliance_lifts_a_veto`, `onboarding_again_after_a_lifted_veto_keeps_the_identity`, `a_wallet_can_be_vetoed_before_it_onboards`, `onboarding_without_a_valid_claim_reverts_and_registers_nothing` and `recovery_is_not_offered`.
* `a_delisted_holder_can_still_queue_an_exit`: Verifies de-listed holders can queue redemption via forced transfer.
* `a_delisted_holder_can_still_claim_their_exit`: Verifies de-listed holders always receive cash payout.
* `a_delisted_investor_can_cancel_deposit_and_receive_asset`: Verifies de-listed depositors can cancel and receive cash back.
* `a_delisted_holder_cannot_cancel_redemption_back_to_shares`: Verifies de-listed holders cannot abort redemption back into shares.
* `share_returns::*` ([`test/share_returns.rs`](../contracts/async-vault/src/test/share_returns.rs)): Verifies a cancel returns the shares while the vault's own address is delisted or the token is paused, keeps a partial freeze on the returned shares, refuses a cancel the compliance rules refuse with `HolderNotEligible`, and burns the shares of a zero-asset claim the rules refuse to return, or fail on.
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
* `legal_transfer::*` ([`contracts/share-token/src/test.rs`](../contracts/share-token/src/test.rs)): Verifies a legal-order transfer needs compliance and governance as two different accounts, never moves shares out of or into the vault's address, lands only on a verified account and publishes its order reference; recovery needs the same co-signature, and the vault's address cannot be frozen.
