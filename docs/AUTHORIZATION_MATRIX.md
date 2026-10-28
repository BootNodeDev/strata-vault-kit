# Authorization & Access Control Matrix

This document provides the complete authorization and role model specification for the Strata Vault Kit across all five contracts (`AsyncVault`, `ShareToken`, `NavOracle`, `IdentityVerifier` and `Compliance`).

---

## 1. Architectural Principles

1. **Direct Role Membership Checks**: Role membership is checked directly via `has_role(e, &caller, &role)` or `stellar_macros::only_role` / `only_admin`, never by enumerating members.
2. **One signature per account**: A privileged call asks each account it needs for exactly one signature, on that call. No production entrypoint takes a caller argument it does not check.
   - An admin entrypoint the kit defines takes no caller argument. `#[only_admin]` reads the stored admin and asks it to sign.
   - Where an OpenZeppelin trait fixes a `caller` or `operator` argument (`pause`, `unpause`, `set_compliance`, `set_identity_verifier`), the entrypoint refuses any account other than the stored admin with `AdminRequired`, then asks that account to sign.
   - A role entrypoint checks the role of the `caller` or `operator` it names, then asks that account to sign. `legal_transfer` and `recover_balance` also ask the admin, a different account, to sign the same call.
   - The testnet stubs are the exception. The compliance contract's `bind_token`, `unbind_token`, `add_module_to` and `remove_module_from`, and the identity verifier's `set_claim_topics_and_issuers`, keep the `operator` argument their trait fixes but do not read it. `#[only_admin]` asks the stored admin to sign, so each still asks for one signature. Production replaces both stubs with external contracts (§5.4, §5.5).
3. **Exit guarantee, with one hold**: A covered redemption claim pays out cash regardless of pause, staleness or allowlist status. A delisted investor exits through the cash path and cannot re-enter share circulation. A frozen investor is held: the vault refuses their requests, cancellations and claims, and pays them only after the freeze lifts.
4. **Five Separate Authorities, plus the Vault's `manager` Role**:
   - **Governance (Admin)**: Root authority; upgrades, timelock parameters, custodian settings, unpause, oracle parameters, emergency NAV pause reset. As the share token's admin, it co-signs compliance's `legal_transfer` and `recover_balance`.
   - **Manager (vault role, not an authority)**: Closes epochs.
   - **Treasury**: Deploys free reserve assets to custodian.
   - **Guardian**: Emergency responder; pauses vault entries, pauses the oracle's NAV.
   - **Attester (Oracle)**: Submits off-chain valuation reports within strict deviation and rate bounds.
   - **Compliance**: Writes the allowlist on the identity verifier and holds the share token's `compliance` role for freezes and partial freezes. It moves shares only with `legal_transfer` or `recover_balance`, each needing governance's co-signature in the same call, and never into or out of the vault's address. Cannot mint, burn, call `forced_transfer`, or swap the token's compliance or identity-verifier contract.

---

## 2. The Dual `manager` Roles Distinction

The symbol `"manager"` names two completely distinct roles living on separate contracts with separate privileges:

| Contract | Role Symbol | Held By | Scope & Privileges |
|---|---|---|---|
| **`AsyncVault`** | `symbol_short!("manager")` | Operator Multisig / Automation Bot | Strictly calls `close_epoch` to freeze orders for pricing. Holds **no** token minting or burning power. |
| **`ShareToken`** | `symbol_short!("manager")` | `AsyncVault` Contract Instance | Authorized to call `mint` (claim deposits), `burn` (claim redemptions) and `forced_transfer` (escrow redemptions and return escrowed shares). Holds no freeze or recovery power. |

The share token has a third role, `"compliance"`, held by the compliance authority: freezes and partial freezes, plus `legal_transfer` and `recover_balance` with governance's co-signature. Only `manager` reaches `forced_transfer`, which the vault uses to escrow redemptions and to return escrowed shares after its own eligibility check.

### Deployment Script Safety
In `scripts/harness/deploy.ts` and automated deployment scripts, the separation is enforced structurally:
- The vault's constructor receives `roles.manager = accounts.manager.publicKey()`.
- The share token's constructor grants `compliance` to the compliance key and grants `manager` to no one; the identity verifier is constructed with the compliance key as admin.
- The share token role is granted to the deployed vault contract: `token.grant_role({ account: asyncVault.address, role: "manager", caller: governance })`.
- After granting, the script checks `token.has_role({ account: vault, role: "manager" })` and stops if the vault does not hold the role. That no other account holds it is checked by the vault's `finish_setup` below.
- It then calls `token.bind_vault({ vault })` and `token.finish_setup()`, each signed by governance, and stops if `token.setup_open()` still reads true. From then on the token's admin changes wait for the vault's timelock (§5.2).
- It calls `compliance.bind_token({ token, operator: governance })`, then `compliance.bind_vault({ vault })` and `compliance.finish_setup()`, and stops if `compliance.setup_open()` still reads true. From then on the compliance contract's module, token-binding and admin changes wait for the vault's timelock (§5.5).
- It calls `oracle.bind_vault({ vault })` and `oracle.finish_setup()`, and stops if `oracle.setup_open()` still reads true. From then on the oracle's admin changes wait for the vault's timelock (§5.3).
- Last, it calls `vault.set_custodian({ custodian })` and `vault.finish_setup()`, and stops if `vault.setup_open()` still reads true. `finish_setup` refuses with `SetupIncomplete` unless the token and the oracle report this vault with their setup closed, the vault is the token's only `manager`, the token has no shares outstanding, the vault passes the identity check, its address is not frozen on the token and the token is bound to its compliance contract. It also needs the asset to have the token's decimals, four different addresses for the asset, the token, the oracle and the vault, an oracle that answers as a feed, and a custodian other than the vault. A compliance contract that answers `vault()` and `setup_open()` must report this vault with its setup closed; one that does not answer them is an external module and is accepted. The script then reads `vault.health()` and stops if any wiring field is false. From then on the vault takes deposits and its admin changes wait for its timelock (§5.1).

---

## 3. Vault Constructor Authority Handling

`AsyncVault::__constructor` accepts `VaultRoles`, which includes `governance`, `manager`, `treasury`, `guardian`, `compliance`, and `attester`.
- **What the constructor does with `compliance` and `attester`**:
  It checks four pairs and refuses an address that appears in both seats (`RolesNotDistinct`):
  `treasury != guardian`, `treasury != governance`, `compliance != governance`, and `compliance != treasury`.
  No other pair is compared: governance and guardian may be one account, and the manager is unconstrained. The vault stores neither `compliance` nor `attester` and grants neither a role. `compliance` is read only by that check; `attester` is neither stored nor compared, so nothing ties it to the oracle's attester. Compliance acts on the identity verifier and the share token, and attestation on the oracle.

---

## 4. Open Entrypoints and Design Rationale

The following entrypoints are open to any caller on purpose:

| Contract | Entrypoint | Authorization | Rationale |
|---|---|---|---|
| **`AsyncVault`** | `fund` | `caller.require_auth()` | Anyone (treasury, LP, custodian, donor) may fund the vault with settlement assets. `caller.require_auth()` ensures that the sender explicitly approves transferring their own assets into the vault. Receiving capital is non-privileged and always safe. |
| **`AsyncVault`** | `fulfill_epoch` | Open (Any caller) | Pricing is deterministic once an epoch is closed and the oracle publishes a valid attestation. Permissionless fulfillment prevents a malicious operator from stalling pricing or censoring settlements. Guarded by `#[when_not_paused]` and oracle validity. |
| **`AsyncVault`** | `activate_wind_down` | Open (Any caller) | Once governance announces wind-down and the timelock expires, anyone (including investors) can trigger activation. This ensures an operator cannot propose wind-down to block deposits and then stall activation indefinitely. |
| **`AsyncVault`** | `finalize_wind_down_round` | Open (Any caller) | Distributing returned capital pro-rata across the supply snapshot is deterministic. Making finalisation open ensures investors or keepers can trigger payout rounds immediately when funds arrive. |
| **`AsyncVault`** | `claim_wind_down` | `holder.require_auth()` | The holder signs their own claim; a keeper cannot claim for them. The payout goes to `holder`. |
| **`AsyncVault`** | `request_deposit` | `holder.require_auth()` | Investor entrypoint. Deposits escrowed cash; guarded by `when_not_paused`, not winding down, and refused with `SetupOpen` until the vault's setup finishes, so every deposit is covered by the timelock. |
| **`AsyncVault`** | `claim_deposit` | `holder.require_auth()` | Investor entrypoint. Mints the shares once the epoch is priced; the token checks the receiver on `mint`. A delisted holder's shares become an exit instead (`DepositConvertedToExit`): they join the holder's redemption in the open epoch, or the holder's wind-down entitlement during a wind-down. A frozen holder's claim is held (`Frozen`). |
| **`AsyncVault`** | `cancel_deposit` | `holder.require_auth()` | Investor exit while the epoch cannot be priced. Refunds the whole escrowed deposit in one step, delisted or not. A frozen holder is held (`Frozen`). |
| **`AsyncVault`** | `request_redeem` | `holder.require_auth()` | Investor exit. Open during a pause and to a delisted holder; refused during a wind-down (`WindDownActive`). |
| **`AsyncVault`** | `claim_redeem` | `holder.require_auth()` | Investor exit. Pays settlement asset once covered. |
| **`AsyncVault`** | `cancel_redeem` | `holder.require_auth()` | Investor exit while the epoch cannot be priced. Outside a wind-down the vault checks the holder itself and returns the escrowed shares with the manager `forced_transfer`; it refuses a delisted holder (`NotAllowlisted`) and a move the compliance rules refuse (`HolderNotEligible`). In an active wind-down the escrow is surrendered into the holder's wind-down entitlement instead (`RedemptionSurrendered`). A frozen holder is held (`Frozen`) either way. |

---

## 5. Complete Access Control Matrix Across All 5 Contracts

### 5.1 AsyncVault (`contracts/async-vault`)

The vault's `admin` is governance. Until `finish_setup`, admin changes are instant and the vault takes no deposit (`SetupOpen`). Setup finishes once the wiring is complete and no admin hand-over offered during setup is pending, and it never reopens. After setup, the following wait for the timelock through `propose_change`/`apply_change`: the custodian, grants, revoking `manager`, admin hand-over, lowering the notice or the wind-down delay, the oracle, and upgrades. Raising the notice or the wind-down delay, the deposit cap, `pause`/`unpause` and revoking `treasury` or `guardian` stay instant. During an active wind-down nothing timelocked is proposed or applied, a `manager` revoke included.

Tests: [`controls.rs`](../contracts/async-vault/src/test/controls.rs), [`epochs.rs`](../contracts/async-vault/src/test/epochs.rs), [`governance.rs`](../contracts/async-vault/src/test/governance.rs), [`notice.rs`](../contracts/async-vault/src/test/notice.rs), [`setup.rs`](../contracts/async-vault/src/test/setup.rs), [`treasury.rs`](../contracts/async-vault/src/test/treasury.rs), [`upgrade.rs`](../contracts/async-vault/src/test/upgrade.rs) and [`wind_down.rs`](../contracts/async-vault/src/test/wind_down.rs) in [`contracts/async-vault/src/test/`](../contracts/async-vault/src/test/). [`signatures.rs`](../contracts/async-vault/src/test/signatures.rs) checks that each privileged call below asks one account for one signature, on that call only.

| Entrypoint | Access Control / Caller Auth | State & Precondition Guards | Tested Refusal (Test Name) |
|---|---|---|---|
| `close_epoch` | `#[only_role(caller, "manager")]` | Epoch must be open | `test::epochs::a_non_manager_cannot_close` |
| `deploy_to_custodian` | `#[only_role(caller, "treasury")]` | `assets <= free_reserve`, not winding down | `test::treasury::deploying_needs_the_treasury_role` |
| `pause` | `#[only_role(caller, "guardian")]` | Contract not already paused | `test::controls::only_the_guardian_pauses` |
| `unpause` | `caller` must be the stored admin (`AdminRequired`), then `caller.require_auth()` | Contract must be paused | `test::controls::the_guardian_pauses_but_only_governance_unpauses`, `test::controls::a_caller_other_than_the_admin_cannot_unpause_even_when_it_signs` |
| `set_custodian` | `#[only_admin]` | Never the vault itself (`InvalidCustodian`, checked first). Instant during setup; `UseTimelock` after | `test::governance::the_custodian_changes_through_the_timelock`, `test::treasury::setting_the_custodian_needs_the_admin_signature`, `test::treasury::setting_the_vault_as_its_own_custodian_is_refused` |
| `set_notice` | `#[only_admin]` | `secs <= MAX_NOTICE_SECS`, `secs <= upgrade_delay`. Raising is instant; lowering is `UseTimelock` after setup | `test::governance::raising_the_notice_is_instant_and_lowering_waits`, `test::notice::setting_the_notice_needs_governance_authorisation` |
| `set_wind_down_delay` | `#[only_admin]` | `MIN_WIND_DOWN_DELAY <= secs <= MAX_WIND_DOWN_DELAY`. Raising is instant; lowering is `UseTimelock` after setup | `test::governance::raising_the_wind_down_delay_is_instant_and_lowering_waits`, `test::governance::a_wind_down_delay_below_the_minimum_cannot_be_proposed`, `test::wind_down::only_governance_sets_the_delay` |
| `set_deposit_cap` | `#[only_admin]` | Not negative. Instant both ways, also after setup | `test::governance::the_deposit_cap_stays_instant_both_ways` |
| `finish_setup` | `#[only_admin]` | Once. The token and the oracle report this vault with their setup closed, the vault is the token's only `manager`, the token's `total_supply` is zero, the vault passes `verify_identity`, the token's `is_frozen` is false for the vault, and the token is in its compliance contract's `linked_tokens`; a compliance contract that answers `vault()` and `setup_open()` reports this vault with its setup closed (one that does not answer them is an external module and is accepted); the asset's `decimals` equal the token's; the asset, the token, the oracle and the vault are four different addresses; the oracle answers `state()` and `freshness_duration()`; a custodian other than the vault is set; no admin hand-over offered during setup is pending | `test::setup::every_wiring_step_is_checked_before_setup_finishes`, `test::setup::a_compliance_contract_from_outside_the_kit_is_accepted`, `test::setup::setup_cannot_finish_while_a_hand_over_is_pending`, `test::setup::setup_never_finishes_twice`, `test::setup::only_governance_finishes_setup` |
| `grant_role` / `transfer_admin_role` | Admin | Instant during setup, `UseTimelock` after. A zero `live_until_ledger` cancels instantly | `test::governance::grants_and_manager_revokes_wait_for_the_timelock`, `test::governance::an_admin_hand_over_waits_but_cancelling_one_does_not` |
| `accept_admin_transfer` | The pending admin's auth | A hand-over is pending; an applied `Admin` change stays open for seven days of ledgers; refused while the vault winds down (`WindDownActive`) | `test::governance::an_applied_admin_change_starts_a_hand_over_the_next_admin_accepts`, `test::governance::the_hand_over_offer_lasts_seven_days_of_ledgers`, `test::governance::an_admin_hand_over_waits_but_cancelling_one_does_not`, `test::setup::setup_cannot_finish_while_a_hand_over_is_pending`, `test::governance::an_admin_hand_over_cannot_be_accepted_during_a_wind_down` |
| `revoke_role` | Admin | `treasury`, `guardian`: instant. `manager`: instant during setup, `UseTimelock` after | `test::governance::grants_and_manager_revokes_wait_for_the_timelock` (instant case: `test::governance::revoking_treasury_or_guardian_stays_instant`; caller check: `test::governance::only_the_admin_revokes_a_role`) |
| `renounce_role` | The role holder, `caller.require_auth()` (OpenZeppelin's default) | The caller holds the role (`RoleNotHeld`); instant for every role, `manager` included | `test::signatures::each_role_call_asks_its_holder_for_one_signature` |
| `set_role_admin` | — | Always refused (`UseTimelock`) | `test::governance::no_role_ever_gets_a_role_admin` |
| `propose_wind_down` | `#[only_admin]` | No proposal standing, not active | `test::wind_down::only_governance_proposes` |
| `cancel_wind_down_proposal` | `#[only_admin]` | Must be proposed, not active | `test::wind_down::governance_cancels_a_proposal_before_activation` |
| `propose_change` | `#[only_admin]` | Not winding down, setup finished, one code change at a time, an `UpgradeDelay` in `[MIN, MAX]` and `>= notice`, a `Notice` within its bounds, a `WindDownDelay` in `[MIN_WIND_DOWN_DELAY, MAX_WIND_DOWN_DELAY]`, a `Custodian` that is not the vault (`InvalidCustodian`) | `test::upgrade::only_governance_proposes_and_cancels`, `test::upgrade::nothing_is_proposed_during_a_wind_down`, `test::setup::nothing_is_proposed_during_setup`, `test::governance::a_custodian_change_to_the_vault_is_refused_when_proposed_and_when_applied` |
| `cancel_change` | `#[only_admin]` | The change must be pending | `test::upgrade::only_governance_proposes_and_cancels` |
| `apply_change` | `#[only_admin]` | Eta passed, not paused, not winding down, delay `>= notice`; an `UpgradeDelay`, `Notice`, `WindDownDelay` or `Custodian` change is checked against its bounds again | `test::upgrade::only_governance_applies`, `test::governance::a_change_shorter_than_a_raised_notice_never_lands`, `test::governance::nothing_timelocked_moves_during_a_wind_down_a_manager_revoke_included`, `test::governance::a_custodian_change_to_the_vault_is_refused_when_proposed_and_when_applied` |
| `propose_change` (`Oracle(address)`) | `#[only_admin]` | The feed names this vault, its setup is closed, and it answers `state()` and `freshness_duration()` (`FeedNotBound`) | `test::oracle_swap::a_feed_outside_this_vault_is_never_proposed`, `test::oracle_swap::a_contract_that_is_not_a_feed_is_refused_when_proposed_and_when_applied` |
| `apply_change` (`Oracle(address)`) | `#[only_admin]` | Delay run; the feed still names this vault with its setup closed, and still answers `state()` and `freshness_duration()` (`FeedNotBound`) | `test::oracle_swap::the_oracle_changes_only_through_the_timelock`, `test::oracle_swap::a_feed_that_stops_naming_this_vault_is_never_installed`, `test::oracle_swap::a_contract_that_is_not_a_feed_is_refused_when_proposed_and_when_applied` |
| `pending_changes` | Open view | None | None (view) |
| `renounce_admin` | Refused always (`VaultError::AdminRequired`) | None | `test::controls::governance_cannot_renounce_itself_out_of_the_vault`; `test::controls::governance_hands_over_in_two_steps_instead`; `test::governance::an_applied_admin_change_starts_a_hand_over_the_next_admin_accepts`. Hand over by proposing and applying an `Admin` change (`transfer_admin_role` during setup), then the nominee calls `accept_admin_transfer`. |

### 5.2 ShareToken (`contracts/share-token`)

The token's `admin` is governance; the guardian holds no role on the token. Until `finish_setup`, admin changes are instant, so the deploy can grant the vault the `manager` role. Setup cannot finish while an admin hand-over offered during setup is pending. After setup, the following wait for the vault's timelock through `propose_change`/`apply_change`: grants, revoking `manager`, admin hand-over, `set_compliance`, `set_identity_verifier` and upgrades. A compliance or verifier swap is checked when proposed and again when applied: new rules must list the token, and rules that answer `vault()` and `setup_open()` must run on the vault's clock with their setup closed. As at `finish_setup`, rules that do not answer them count as an external module and are accepted. A new verifier must accept the vault. Revoking `compliance` and `pause`/`unpause` stay instant. The `manager` role is held by the vault and the `compliance` role by the compliance authority. The token's `pause` refuses SEP-41 transfers between holders only. The vault's own escrow moves (`forced_transfer`), mint and burn ignore it, so a token pause stops neither entry nor exit.

Tests: [`contracts/share-token/src/test.rs`](../contracts/share-token/src/test.rs) and [`contracts/share-token/src/test_governance.rs`](../contracts/share-token/src/test_governance.rs). What each privileged call asks to sign: `test_governance::each_admin_call_asks_the_admin_for_one_signature`, `test::each_role_call_asks_its_holder_for_one_signature` and `test::legal_transfer::a_legal_transfer_or_a_recovery_asks_each_signer_once`.

| Entrypoint | Access Control / Caller Auth | State & Precondition Guards | Tested Refusal (Test Name) |
|---|---|---|---|
| `pause` | `caller` must be the stored admin (`AdminRequired`), then `caller.require_auth()` | Not paused | `test::unauthorized_caller_cannot_pause_or_unpause`, `test_governance::a_caller_other_than_the_admin_is_refused_even_when_it_signs` |
| `unpause` | `caller` must be the stored admin (`AdminRequired`), then `caller.require_auth()` | Paused | `test::unauthorized_caller_cannot_pause_or_unpause`, `test_governance::a_caller_other_than_the_admin_is_refused_even_when_it_signs` |
| `mint` | `#[only_role(operator, "manager")]` | Receiver allowlisted | `test::unauthorized_caller_cannot_mint`, `test::the_compliance_authority_cannot_mint_burn_or_swap_the_rules` |
| `burn` | `#[only_role(operator, "manager")]` | Balance sufficient | `test::unauthorized_caller_cannot_burn` |
| `forced_transfer` | `#[only_role(operator, "manager")]` | Balance sufficient | `test::unauthorized_caller_cannot_forced_transfer`, `test::legal_transfer::compliance_no_longer_forces_transfers` |
| `legal_transfer` | `#[only_role(caller, "compliance")]` and the admin's `require_auth()` in the same call, from two different accounts (`CoSignRequired`) | Reference of 1–128 bytes (`InvalidReference`); never from or to the vault's address (`VaultAddress`); destination passes `verify_identity`; balance sufficient | `test::legal_transfer::*` |
| `set_address_frozen` | `#[only_role(operator, "compliance")]` | Never freezes the bound vault's address (`VaultAddress`); unfreezing it stays possible | `test::unauthorized_caller_cannot_freeze_or_recover`, `test::the_manager_escrows_but_does_not_intervene`, `test::legal_transfer::the_vault_address_cannot_be_frozen` |
| `freeze_partial_tokens` | `#[only_role(operator, "compliance")]` | Balance sufficient; never the bound vault's address (`VaultAddress`) | `test::unauthorized_caller_cannot_freeze_or_recover`, `test::the_manager_escrows_but_does_not_intervene`, `test::legal_transfer::the_vault_address_cannot_be_frozen` |
| `unfreeze_partial_tokens`| `#[only_role(operator, "compliance")]` | Frozen amount sufficient | `test::unauthorized_caller_cannot_freeze_or_recover`, `test::the_manager_escrows_but_does_not_intervene` |
| `recover_balance` | `#[only_role(operator, "compliance")]` and the admin's `require_auth()` in the same call, from two different accounts (`CoSignRequired`) | Never from or to the vault's address (`VaultAddress`); target allowlisted and named by the verifier's `recovery_target` (the testnet stub names none, so recovery always fails there) | `test::unauthorized_caller_cannot_freeze_or_recover`, `test::the_compliance_authority_reaches_recovery`, `test::legal_transfer::recovery_needs_the_admin_too`, `test::legal_transfer::recovery_never_takes_the_vault_balance`, `test::legal_transfer::recovery_never_lands_on_the_vault_address` |
| `set_compliance` | `operator` must be the stored admin (`AdminRequired`), then `operator.require_auth()` | Instant during setup; `UseTimelock` after | `test::unauthorized_caller_cannot_set_compliance_or_verifier`, `test::the_compliance_authority_cannot_mint_burn_or_swap_the_rules`, `test_governance::rule_and_verifier_swaps_wait_after_setup`, `test_governance::a_caller_other_than_the_admin_is_refused_even_when_it_signs` |
| `set_identity_verifier` | `operator` must be the stored admin (`AdminRequired`), then `operator.require_auth()` | Instant during setup; `UseTimelock` after | `test::unauthorized_caller_cannot_set_compliance_or_verifier`, `test::the_compliance_authority_cannot_mint_burn_or_swap_the_rules`, `test_governance::rule_and_verifier_swaps_wait_after_setup`, `test_governance::a_caller_other_than_the_admin_is_refused_even_when_it_signs` |
| `renounce_admin` | Refused always (`ShareTokenError::AdminRequired`) | None | `test::the_admin_cannot_renounce_itself_out_of_the_token`; `test::admin_handover_in_two_steps_still_works`; `test_governance::an_applied_admin_change_starts_a_hand_over_the_next_admin_accepts`. A token without an admin could never be unpaused or rotate its manager; hand over by proposing and applying an `Admin` change (`transfer_admin_role` during setup), then the nominee calls `accept_admin_transfer`. |
| `bind_vault` | `#[only_admin]` | During setup, once; the vault must answer `timelock_clock` | `test_governance::a_second_vault_cannot_be_bound`, `test_governance::an_address_that_reports_no_clock_cannot_be_bound` |
| `finish_setup` | `#[only_admin]` | Needs a bound vault and no pending admin hand-over; once | `test_governance::setup_is_open_until_finished_and_never_reopens`, `test_governance::setup_cannot_finish_while_a_hand_over_is_pending` |
| `propose_change` | `#[only_admin]` | After setup; vault not winding down; one upgrade at a time | `test_governance::nothing_is_proposed_during_setup`, `test_governance::only_the_admin_proposes_cancels_and_applies` |
| `cancel_change` | `#[only_admin]` | The change must be pending | `test_governance::only_the_admin_proposes_cancels_and_applies` |
| `apply_change` | `#[only_admin]` | Delay run on the vault's clock, vault unpaused and not winding down, delay `>=` the vault's notice | `test_governance::a_vault_pause_moves_the_eta_and_holds_the_change`, `test_governance::a_change_shorter_than_a_raised_notice_never_lands` |
| `propose_change` (`Compliance(address)`, `IdentityVerifier(address)`) | `#[only_admin]` | New rules list the token in `linked_tokens`, and rules that answer `vault()` and `setup_open()` name the token's vault with their setup closed (`ComplianceNotBound`); rules that do not answer them count as an external module and are accepted. A new verifier's `verify_identity` accepts the vault's address (`VerifierRefusesVault`). Rules that do not answer `linked_tokens` and a verifier that does not answer fail | `test_governance::rules_off_this_vaults_clock_or_without_the_token_are_never_proposed`, `test_governance::a_verifier_that_refuses_the_vault_or_cannot_answer_is_never_proposed`, `test::compliance::an_unbound_compliance_swap_is_refused_and_every_move_goes_on` in `contracts/async-vault` |
| `apply_change` (`Compliance(address)`, `IdentityVerifier(address)`) | `#[only_admin]` | Delay run; the new rules or verifier still pass the same check | `test_governance::applied_rule_and_verifier_changes_take_effect`, `test_governance::rules_that_stop_qualifying_are_never_installed`, `test_governance::rules_from_outside_the_kit_are_installed_while_they_list_the_token`, `test_governance::rules_that_stop_answering_a_binding_view_are_installed_as_external`, `test_governance::a_verifier_that_stops_accepting_the_vault_is_never_installed` |
| `pending_changes` | Open view | None | None (view) |
| `grant_role` | Admin, `caller.require_auth()` | Instant during setup; `UseTimelock` after | `test_governance::grants_and_manager_revokes_wait_after_setup` |
| `revoke_role` | Admin, `caller.require_auth()` | `compliance`: instant. `manager`: instant during setup, `UseTimelock` after | `test_governance::grants_and_manager_revokes_wait_after_setup` (the instant case: `test_governance::revoking_compliance_stays_instant_after_setup`) |
| `renounce_role` | The role holder, `caller.require_auth()` (OpenZeppelin's default) | The caller holds the role (`RoleNotHeld`); instant | `test::each_role_call_asks_its_holder_for_one_signature` |
| `transfer_admin_role` | Admin | Instant during setup; `UseTimelock` after. A zero `live_until_ledger` cancels at once | `test_governance::an_admin_hand_over_waits_but_cancelling_one_does_not` |
| `accept_admin_transfer` | The pending admin's auth | A hand-over is pending; an applied `Admin` change stays open for seven days of ledgers; refused while the vault winds down (`WindDownActive`) | `test_governance::an_applied_admin_change_starts_a_hand_over_the_next_admin_accepts`, `test_governance::the_hand_over_offer_lasts_seven_days_of_ledgers`, `test_governance::an_admin_hand_over_waits_but_cancelling_one_does_not`, `test_governance::setup_cannot_finish_while_a_hand_over_is_pending`, `test_governance::an_admin_hand_over_cannot_be_accepted_while_the_vault_winds_down` |
| `set_role_admin` | Refused always (`ShareTokenError::UseTimelock`) | None | `test_governance::no_role_ever_gets_a_role_admin`. A role admin could grant its role with no delay. |
| `upgrade` | Not exposed | Upgrades go through `propose_change(Upgrade)` | `test::upgrade::with_wasm::the_token_exposes_no_immediate_upgrade` in `contracts/async-vault` (needs `upgrade_wasm`): the built token refuses `upgrade` with a real uploaded hash because it exports no such function |

### 5.3 NavOracle (`contracts/nav-oracle`)

The oracle's `admin` is governance; its attester and guardian are constructor parameters. Until `finish_setup`, admin changes are instant. Setup cannot finish while an admin hand-over offered during setup is pending. After setup, the following wait for the vault's timelock through `propose_change`/`apply_change`: grants, admin hand-over, every `set_config` change except a shorter `freshness_duration`, and upgrades. Revoking `attester` or `guardian`, the NAV pause (`pause_nav`, `set_nav_paused`) and `clear_latest` stay instant.

Tests: [`contracts/nav-oracle/src/test.rs`](../contracts/nav-oracle/src/test.rs) and [`contracts/nav-oracle/src/test_governance.rs`](../contracts/nav-oracle/src/test_governance.rs). What each privileged call asks to sign: `test_governance::each_admin_call_asks_the_admin_for_one_signature` and `test_governance::each_role_call_asks_its_holder_for_one_signature`.

| Entrypoint | Access Control / Caller Auth | State & Precondition Guards | Tested Refusal (Test Name) |
|---|---|---|---|
| `attest` | `#[only_role(caller, "attester")]` | Refused while the NAV is paused; cooldown, deviation cap, bounds `[min, max]`; expiry capped at the freshness window; non-empty proof hash, proof URI ≤ 256 bytes | `test::attest_is_role_gated`, `test::attesting_is_refused_while_the_nav_is_paused`, `test::proof_reference::a_report_without_a_proof_hash_is_refused`, `test::proof_reference::a_proof_uri_past_the_limit_is_refused` |
| `pause_nav` | `#[only_role(caller, "guardian")]` | None; instant after setup too | `test::pausing_the_nav_is_limited_to_the_guardian` (the instant case: `test_governance::the_nav_pause_and_clearing_stay_instant_after_setup`) |
| `set_nav_paused` | `#[only_admin]` | None; instant after setup too | `test::the_guardian_pauses_the_nav_but_unpausing_needs_governance` |
| `clear_latest` | `#[only_admin]` | NAV must be paused; instant after setup too | `test::only_admin_can_clear_latest`, `test::the_record_clears_only_while_the_nav_is_paused` |
| `set_config` | `#[only_admin]` | Valid bounds. Instant while setup is open, or when the change is only a shorter `freshness_duration`; `UseTimelock` otherwise. Applying a `Config` change sets every field, freshness included; to keep a cut made after the proposal, cancel the queued change and propose again | `test::only_admin_can_set_config`, `test_governance::a_tighter_cap_or_band_waits_after_setup`, `test_governance::a_config_that_tightens_one_field_and_loosens_another_waits`, `test_governance::a_shorter_freshness_window_with_a_looser_field_waits`, `test_governance::a_freshness_cut_below_the_cooldown_is_refused` |
| `renounce_admin` | Refused always (`OracleError::AdminRequired`) | None | `test::the_oracle_admin_cannot_renounce_itself_away`; `test_governance::an_applied_admin_change_starts_a_hand_over_the_next_admin_accepts`. An oracle without an admin could never be reconfigured, clear a stuck record or unpause the NAV; hand over by proposing and applying an `Admin` change (`transfer_admin_role` during setup), then the nominee calls `accept_admin_transfer`. |
| `bind_vault` | `#[only_admin]` | During setup, once; the vault must answer `timelock_clock` | `test_governance::setup_is_open_until_finished_and_never_reopens`, `test_governance::a_second_vault_cannot_be_bound`, `test_governance::an_address_that_reports_no_clock_cannot_be_bound` |
| `finish_setup` | `#[only_admin]` | Needs a bound vault and no pending admin hand-over; once | `test_governance::setup_is_open_until_finished_and_never_reopens`, `test_governance::setup_cannot_finish_while_a_hand_over_is_pending` |
| `propose_change` | `#[only_admin]` | After setup; vault not winding down; one upgrade at a time; a `Config` change must pass the constructor's bounds | `test_governance::nothing_is_proposed_during_setup`, `test_governance::an_invalid_config_cannot_be_proposed`, `test_governance::only_the_admin_proposes_cancels_and_applies` |
| `cancel_change` | `#[only_admin]` | The change must be pending | `test_governance::only_the_admin_proposes_cancels_and_applies` |
| `apply_change` | `#[only_admin]` | Delay run on the vault's clock, vault unpaused and not winding down, delay `>=` the vault's notice; a `Config` change must still pass the bounds | `test_governance::a_vault_pause_moves_the_eta_and_holds_the_change`, `test_governance::nothing_is_proposed_or_applied_while_the_vault_winds_down`, `test_governance::a_change_shorter_than_a_raised_notice_never_lands`, `test_governance::a_config_outside_the_bounds_is_refused_when_it_applies` |
| `pending_changes` | Open view | None | None (view) |
| `grant_role` | Admin, `caller.require_auth()` | Instant during setup; `UseTimelock` after | `test_governance::grants_wait_after_setup_and_land_through_the_timelock` |
| `revoke_role` | Admin, `caller.require_auth()` | Instant: taking an attester or a guardian away moves no value | `test_governance::only_the_admin_revokes_a_role` (the instant case: `test_governance::revoking_an_attester_or_a_guardian_stays_instant_after_setup`) |
| `renounce_role` | The role holder, `caller.require_auth()` (OpenZeppelin's default) | The caller holds the role (`RoleNotHeld`); instant | `test_governance::each_role_call_asks_its_holder_for_one_signature` |
| `transfer_admin_role` | Admin | Instant during setup; `UseTimelock` after. A zero `live_until_ledger` cancels at once | `test_governance::an_admin_hand_over_waits_but_cancelling_one_does_not` |
| `accept_admin_transfer` | The pending admin's auth | A hand-over is pending; an applied `Admin` change stays open for seven days of ledgers; refused while the vault winds down (`WindDownActive`) | `test_governance::an_applied_admin_change_starts_a_hand_over_the_next_admin_accepts`, `test_governance::the_hand_over_offer_lasts_seven_days_of_ledgers`, `test_governance::an_admin_hand_over_waits_but_cancelling_one_does_not`, `test_governance::setup_cannot_finish_while_a_hand_over_is_pending`, `test_governance::an_admin_hand_over_cannot_be_accepted_while_the_vault_winds_down` |
| `set_role_admin` | Refused always (`OracleError::UseTimelock`) | None | `test_governance::no_role_ever_gets_a_role_admin`. A role admin could grant its role with no delay. |
| `upgrade` | Not exposed | Upgrades go through `propose_change(Upgrade)` | `test_governance::with_wasm::the_oracle_exposes_no_immediate_upgrade` (needs `upgrade_wasm`): the built oracle refuses `upgrade` with a real uploaded hash because it exports no such function |

### 5.4 IdentityVerifier (`contracts/identity-verifier`)

A testnet-only stub. Its admin is the compliance key and cannot be transferred: the stub exposes no access-control interface, so replacing the compliance key on it means redeploying. So the compliance key loses its power at once only on the share token, where its `compliance` role can be revoked instantly. On this stub it can still allowlist and delist addresses until the token's verifier is swapped for a new deployment; after setup that swap waits for the vault's timelock, at least seven days.

Tests: [`contracts/identity-verifier/src/test.rs`](../contracts/identity-verifier/src/test.rs). What each admin call asks to sign: `test::each_admin_call_asks_the_admin_for_one_signature`.

| Entrypoint | Access Control / Caller Auth | State & Precondition Guards | Tested Refusal (Test Name) |
|---|---|---|---|
| `allow` | `#[only_admin]` (the compliance key) | None | `test::only_admin_can_allow` |
| `set_claim_topics_and_issuers` | `#[only_admin]` (the compliance key); keeps the `operator` the trait fixes and does not read it | None; it changes nothing | None (signature: `test::each_admin_call_asks_the_admin_for_one_signature`) |
| `verify_identity` | Open check (Internal hook) | `is_allowed(account) == true` | `test::verify_identity_checks_allowlist` |

### 5.5 Compliance (`contracts/compliance`)

A testnet-only stub. Its admin is governance. Module changes, token bindings and admin hand-overs are instant during setup and wait for the vault's timelock after `finish_setup`. Each admin call asks the stored admin to sign. Its own entrypoints take no caller argument; its OpenZeppelin trait methods keep the `operator` argument their trait fixes and do not read it (principle 2).

Tests: [`contracts/compliance/src/test/changes.rs`](../contracts/compliance/src/test/changes.rs). What each privileged call asks to sign: `test::changes::each_admin_call_asks_the_admin_for_one_signature`, `test::changes::a_hand_over_asks_each_side_for_one_signature` and `test::changes::each_hook_asks_the_bound_token_for_one_signature`.

| Entrypoint | Access Control / Caller Auth | State & Precondition Guards | Tested Refusal (Test Name) |
|---|---|---|---|
| `bind_vault` | `#[only_admin]` | During setup, once; the vault must answer `timelock_clock` | `test::changes::a_second_vault_or_a_late_vault_is_refused`, `test::changes::an_address_that_reports_no_clock_cannot_be_bound`, `test::changes::only_the_admin_binds_and_finishes` |
| `finish_setup` | `#[only_admin]` | Needs a bound vault and no pending admin hand-over; once | `test::changes::setup_cannot_finish_without_a_vault`, `test::changes::setup_cannot_finish_while_a_hand_over_is_pending`, `test::changes::a_second_vault_or_a_late_vault_is_refused` |
| `bind_token`, `unbind_token`, `add_module_to`, `remove_module_from` | `#[only_admin]`; `operator` is not read | Instant during setup; `UseTimelock` after | `test::changes::after_setup_rule_changes_wait_for_the_timelock` |
| `propose_change` | `#[only_admin]` | After setup; vault not winding down | `test::changes::proposals_wait_until_setup_is_finished`, `test::changes::only_the_admin_proposes_cancels_and_applies` |
| `cancel_change` | `#[only_admin]` | The change must be pending | `test::changes::a_cancelled_change_never_lands` |
| `apply_change` | `#[only_admin]` | Delay run on the vault's clock, vault unpaused and not winding down, delay `>=` the vault's notice | `test::changes::a_proposed_binding_lands_after_the_delay`, `test::changes::nothing_lands_while_the_vault_is_paused_or_winding_down`, `test::changes::a_vault_pause_pushes_the_change_back`, `test::changes::a_change_shorter_than_a_raised_notice_never_lands` |
| `pending_changes` | Open view | None | None (view) |
| `transfer_admin_role` | Admin | Instant during setup; `UseTimelock` after. A zero `live_until_ledger` cancels at once | `test::changes::only_the_admin_offers_or_cancels_a_hand_over`, `test::changes::after_setup_the_admin_hands_over_through_the_timelock`, `test::changes::a_cancelled_hand_over_no_longer_holds_setup_open`, `test::changes::a_hand_over_after_setup_is_cancelled_at_once` |
| `accept_admin_transfer` | The pending admin's auth | A hand-over is pending; an applied `Admin` change stays open for seven days of ledgers; refused while the vault winds down (`WindDownActive`) | `test::changes::only_the_nominee_accepts_a_hand_over`, `test::changes::setup_cannot_finish_while_a_hand_over_is_pending`, `test::changes::the_hand_over_offer_lasts_seven_days_of_ledgers`, `test::changes::an_admin_hand_over_cannot_be_accepted_while_the_vault_winds_down` |
