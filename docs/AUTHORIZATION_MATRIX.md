# Authorization & Access Control Matrix

This document provides the complete authorization and role model specification for the Strata Vault Kit across all five contracts (`AsyncVault`, `ShareToken`, `NavOracle`, `IdentityVerifier` and `Compliance`).

---

## 1. Architectural Principles

1. **Direct Role Membership Checks**: Role membership is checked directly via `has_role(e, &caller, &role)` or `stellar_macros::only_role` / `only_admin`, never by enumerating members.
2. **Strict Caller Authentication**: No entrypoint takes a caller argument that it does not authenticate. Every function accepting a `caller: Address` executes `caller.require_auth()`. The testnet compliance stub is the exception: its admin calls check the stored admin's signature and ignore their `operator` argument (§5.5).
3. **Exit guarantee, with one hold**: A covered redemption claim pays out cash regardless of pause, staleness or allowlist status. A delisted investor exits through the cash path and cannot re-enter share circulation. A frozen investor is held: the vault refuses their requests, cancellations and claims, and pays them only after the freeze lifts.
4. **Five Separate Authorities**:
   - **Governance (Admin)**: Root authority; upgrades, timelock parameters, custodian settings, unpause, oracle parameters, emergency NAV pause reset. As the share token's admin, it co-signs compliance's `legal_transfer` and `recover_balance`.
   - **Manager (Vault)**: Closes epochs.
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
| **`ShareToken`** | `symbol_short!("manager")` | `AsyncVault` Contract Instance | Authorized to call `mint` (claim deposits), `burn` (claim redemptions) and `forced_transfer` (escrow redemptions). Holds no freeze or recovery power. |

The share token has a third role, `"compliance"`, held by the compliance authority: freezes and partial freezes, plus `legal_transfer` and `recover_balance` with governance's co-signature. Only `manager` reaches `forced_transfer`, which the vault uses to escrow redemptions.

### Deployment Script Safety
In `scripts/harness/deploy.ts` and automated deployment scripts, the separation is enforced structurally:
- The vault's constructor receives `roles.manager = accounts.manager.publicKey()`.
- The share token's constructor grants `compliance` to the compliance key and grants `manager` to no one; the identity verifier is constructed with the compliance key as admin.
- The share token role is granted to the deployed vault contract: `token.grant_role({ account: asyncVault.address, role: "manager", caller: governance })`.
- After granting, the script checks `token.has_role({ account: vault, role: "manager" })` and stops if the vault does not hold the role. That no other account holds it is checked by the vault's `finish_setup` below.
- It then calls `token.bind_vault({ vault, caller: governance })` and `token.finish_setup({ caller: governance })`, and stops if `token.setup_open()` still reads true. From then on the token's admin changes wait for the vault's timelock (§5.2).
- It calls `compliance.bind_token({ token, operator: governance })`, then `compliance.bind_vault({ vault, operator: governance })` and `compliance.finish_setup({ operator: governance })`, and stops if `compliance.setup_open()` still reads true. From then on the compliance contract's module, token-binding and admin changes wait for the vault's timelock (§5.5).
- It calls `oracle.bind_vault({ vault, caller: governance })` and `oracle.finish_setup({ caller: governance })`, and stops if `oracle.setup_open()` still reads true. From then on the oracle's admin changes wait for the vault's timelock (§5.3).
- Last, it calls `vault.set_custodian({ custodian, caller: governance })` and `vault.finish_setup({ caller: governance })`, and stops if `vault.setup_open()` still reads true. `finish_setup` refuses with `SetupIncomplete` unless the token and the oracle report this vault with their setup closed, the vault is the token's only `manager`, the token has no shares outstanding, the vault passes the identity check, its address is not frozen on the token and the token is bound to its compliance contract. A compliance contract that answers `vault()` and `setup_open()` must report this vault with its setup closed; one that does not answer them is an external module and is accepted. From then on the vault takes deposits and its admin changes wait for its timelock (§5.1).

---

## 3. Vault Constructor Authority Handling

`AsyncVault::__constructor` accepts `VaultRoles`, which includes `governance`, `manager`, `treasury`, `guardian`, `compliance`, and `attester`.
- **Why `compliance` and `attester` are kept in the constructor**:
  The vault kit enforces an end-to-end separation of duties. At construction, the vault validates pairwise distinctness:
  `treasury != guardian`, `treasury != governance`, `compliance != governance`, and `compliance != treasury`.
  Although compliance is enforced on `IdentityVerifier` / `Compliance` and attestation on `NavOracle`, the vault records and validates the full 5-authority topology at instantiation time to prevent cross-contamination of duties. Neither `compliance` nor `attester` is granted a direct role on the vault itself.

---

## 4. Open Entrypoints and Design Rationale

The following entrypoints are open to any caller on purpose:

| Contract | Entrypoint | Authorization | Rationale |
|---|---|---|---|
| **`AsyncVault`** | `fund` | `from.require_auth()` | Anyone (treasury, LP, custodian, donor) may fund the vault with settlement assets. `from.require_auth()` ensures that the sender explicitly approves transferring their own assets into the vault. Receiving capital is non-privileged and always safe. |
| **`AsyncVault`** | `fulfill_epoch` | Open (Any caller) | Pricing is deterministic once an epoch is closed and the oracle publishes a valid attestation. Permissionless fulfillment prevents a malicious operator from stalling pricing or censoring settlements. Guarded by `#[when_not_paused]` and oracle validity. |
| **`AsyncVault`** | `activate_wind_down` | Open (Any caller) | Once governance announces wind-down and the timelock expires, anyone (including investors) can trigger activation. This ensures an operator cannot propose wind-down to block deposits and then stall activation indefinitely. |
| **`AsyncVault`** | `finalize_wind_down_round` | Open (Any caller) | Distributing returned capital pro-rata across the supply snapshot is deterministic. Making finalisation open ensures investors or keepers can trigger payout rounds immediately when funds arrive. |
| **`AsyncVault`** | `claim_wind_down` | `holder.require_auth()` | The holder signs their own claim; a keeper cannot claim for them. The payout goes to `holder`. |
| **`AsyncVault`** | `request_deposit` | `from.require_auth()` | Investor entrypoint. Deposits escrowed cash; guarded by `when_not_paused`, not winding down, and refused with `SetupOpen` until the vault's setup finishes, so every deposit is covered by the timelock. |
| **`AsyncVault`** | `claim_deposit` | `caller.require_auth()` | Investor entrypoint. Claims shares once epoch fulfilled; gated by SEP-57 receiver check on `mint`. |
| **`AsyncVault`** | `cancel_deposit` | `from.require_auth()` | Investor exit before epoch pricing. Single-step refund. |
| **`AsyncVault`** | `request_redeem` | `from.require_auth()` | Investor exit. Always open, even during pause. |
| **`AsyncVault`** | `claim_redeem` | `caller.require_auth()` | Investor exit. Pays settlement asset once covered. |
| **`AsyncVault`** | `cancel_redeem` | `from.require_auth()` | Investor exit before epoch pricing. Returns escrowed shares. |

---

## 5. Complete Access Control Matrix Across All 5 Contracts

### 5.1 AsyncVault (`contracts/async-vault`)

The vault's `admin` is governance. Until `finish_setup`, admin changes are instant and the vault takes no deposit (`SetupOpen`). Setup finishes once the wiring is complete and no admin hand-over offered during setup is pending, and it never reopens. After setup, the following wait for the timelock through `propose_change`/`apply_change`: the custodian, grants, revoking `manager`, admin hand-over, lowering the notice or the wind-down delay, the oracle, and upgrades. Raising the notice or the wind-down delay, the deposit cap, `pause`/`unpause` and revoking `treasury` or `guardian` stay instant. During an active wind-down nothing timelocked is proposed or applied, a `manager` revoke included.

Tests: [`controls.rs`](../contracts/async-vault/src/test/controls.rs), [`epochs.rs`](../contracts/async-vault/src/test/epochs.rs), [`governance.rs`](../contracts/async-vault/src/test/governance.rs), [`notice.rs`](../contracts/async-vault/src/test/notice.rs), [`setup.rs`](../contracts/async-vault/src/test/setup.rs), [`treasury.rs`](../contracts/async-vault/src/test/treasury.rs), [`upgrade.rs`](../contracts/async-vault/src/test/upgrade.rs) and [`wind_down.rs`](../contracts/async-vault/src/test/wind_down.rs) in [`contracts/async-vault/src/test/`](../contracts/async-vault/src/test/).

| Entrypoint | Access Control / Caller Auth | State & Precondition Guards | Tested Refusal (Test Name) |
|---|---|---|---|
| `close_epoch` | `#[only_role(caller, "manager")]` | Epoch must be open | `test::epochs::a_non_manager_cannot_close` |
| `deploy_to_custodian` | `#[only_role(caller, "treasury")]` | `assets <= free_reserve`, not winding down | `test::treasury::deploying_needs_the_treasury_role` |
| `pause` | `#[only_role(caller, "guardian")]` | Contract not already paused | `test::controls::only_the_guardian_pauses` |
| `unpause` | `#[only_admin]`, `caller.require_auth()` | Contract must be paused | `test::controls::the_guardian_pauses_but_only_governance_unpauses` |
| `set_custodian` | `#[only_admin]`, `caller.require_auth()` | Instant during setup; `UseTimelock` after | `test::governance::the_custodian_changes_through_the_timelock`, `test::treasury::setting_the_custodian_needs_the_admin_signature` |
| `set_notice` | `#[only_admin]`, `caller.require_auth()` | `secs <= MAX_NOTICE_SECS`, `secs <= upgrade_delay`. Raising is instant; lowering is `UseTimelock` after setup | `test::governance::raising_the_notice_is_instant_and_lowering_waits`, `test::notice::setting_the_notice_needs_governance_authorisation` |
| `set_wind_down_delay` | `#[only_admin]`, `caller.require_auth()` | `MIN_WIND_DOWN_DELAY <= secs <= MAX_WIND_DOWN_DELAY`. Raising is instant; lowering is `UseTimelock` after setup | `test::governance::raising_the_wind_down_delay_is_instant_and_lowering_waits`, `test::governance::a_wind_down_delay_below_the_minimum_cannot_be_proposed`, `test::wind_down::only_governance_sets_the_delay` |
| `set_deposit_cap` | `#[only_admin]`, `caller.require_auth()` | Not negative. Instant both ways, also after setup | `test::governance::the_deposit_cap_stays_instant_both_ways` |
| `finish_setup` | `#[only_admin]`, `caller.require_auth()` | Once. The token and the oracle report this vault with their setup closed, the vault is the token's only `manager`, the token's `total_supply` is zero, the vault passes `verify_identity`, the token's `is_frozen` is false for the vault, and the token is in its compliance contract's `linked_tokens`; a compliance contract that answers `vault()` and `setup_open()` reports this vault with its setup closed (one that does not answer them is an external module and is accepted); no admin hand-over offered during setup is pending | `test::setup::every_wiring_step_is_checked_before_setup_finishes`, `test::setup::a_compliance_contract_from_outside_the_kit_is_accepted`, `test::setup::setup_cannot_finish_while_a_hand_over_is_pending`, `test::setup::setup_never_finishes_twice`, `test::setup::only_governance_finishes_setup` |
| `grant_role` / `transfer_admin_role` | Admin | Instant during setup, `UseTimelock` after. A zero `live_until_ledger` cancels instantly | `test::governance::grants_and_manager_revokes_wait_for_the_timelock`, `test::governance::an_admin_hand_over_waits_but_cancelling_one_does_not` |
| `revoke_role` | Admin | `treasury`, `guardian`: instant. `manager`: instant during setup, `UseTimelock` after | `test::governance::grants_and_manager_revokes_wait_for_the_timelock` (instant case: `test::governance::revoking_treasury_or_guardian_stays_instant`; caller check: `test::governance::only_the_admin_revokes_a_role`) |
| `set_role_admin` | — | Always refused (`UseTimelock`) | `test::governance::no_role_ever_gets_a_role_admin` |
| `propose_wind_down` | `#[only_admin]`, `caller.require_auth()` | No proposal standing, not active | `test::wind_down::only_governance_proposes` |
| `cancel_wind_down_proposal` | `#[only_admin]`, `caller.require_auth()` | Must be proposed, not active | `test::wind_down::governance_cancels_a_proposal_before_activation` |
| `propose_change` | `#[only_admin]`, `caller.require_auth()` | Not winding down, setup finished, one code change at a time, an `UpgradeDelay` in `[MIN, MAX]` and `>= notice`, a `Notice` within its bounds, a `WindDownDelay` in `[MIN_WIND_DOWN_DELAY, MAX_WIND_DOWN_DELAY]` | `test::upgrade::only_governance_proposes_and_cancels`, `test::upgrade::nothing_is_proposed_during_a_wind_down`, `test::setup::nothing_is_proposed_during_setup` |
| `cancel_change` | `#[only_admin]`, `caller.require_auth()` | The change must be pending | `test::upgrade::only_governance_proposes_and_cancels` |
| `apply_change` | `#[only_admin]`, `caller.require_auth()` | Eta passed, not paused, not winding down, delay `>= notice`; an `UpgradeDelay`, `Notice` or `WindDownDelay` change is checked against its bounds again | `test::upgrade::only_governance_applies`, `test::governance::a_change_shorter_than_a_raised_notice_never_lands`, `test::governance::nothing_timelocked_moves_during_a_wind_down_a_manager_revoke_included` |
| `propose_change` (`Oracle(address)`) | `#[only_admin]` | The feed names this vault and its setup is closed | `test::oracle_swap::a_feed_outside_this_vault_is_never_proposed` |
| `apply_change` (`Oracle(address)`) | `#[only_admin]` | Delay run; the feed still names this vault with its setup closed, and answers `state()` | `test::oracle_swap::the_oracle_changes_only_through_the_timelock`, `test::oracle_swap::a_feed_that_stops_naming_this_vault_is_never_installed` |
| `pending_changes` | Open view | None | None (view) |
| `renounce_admin` | Refused always (`VaultError::AdminRequired`) | None | `test::controls::governance_cannot_renounce_itself_out_of_the_vault`; `test::controls::governance_hands_over_in_two_steps_instead`; `test::governance::an_applied_admin_change_starts_a_hand_over_the_next_admin_accepts`. Hand over by proposing and applying an `Admin` change (`transfer_admin_role` during setup), then the nominee calls `accept_admin_transfer`. |

### 5.2 ShareToken (`contracts/share-token`)

The token's `admin` is governance; the guardian holds no role on the token. Until `finish_setup`, admin changes are instant, so the deploy can grant the vault the `manager` role. Setup cannot finish while an admin hand-over offered during setup is pending. After setup, the following wait for the vault's timelock through `propose_change`/`apply_change`: grants, revoking `manager`, admin hand-over, `set_compliance`, `set_identity_verifier` and upgrades. Revoking `compliance` and `pause`/`unpause` stay instant. The `manager` role is held by the vault and the `compliance` role by the compliance authority.

Tests: [`contracts/share-token/src/test.rs`](../contracts/share-token/src/test.rs) and [`contracts/share-token/src/test_governance.rs`](../contracts/share-token/src/test_governance.rs).

| Entrypoint | Access Control / Caller Auth | State & Precondition Guards | Tested Refusal (Test Name) |
|---|---|---|---|
| `pause` | `#[only_admin]`, `caller.require_auth()` | Not paused | `test::unauthorized_caller_cannot_pause_or_unpause` |
| `unpause` | `#[only_admin]`, `caller.require_auth()` | Paused | `test::unauthorized_caller_cannot_pause_or_unpause` |
| `mint` | `#[only_role(operator, "manager")]` | Receiver allowlisted | `test::unauthorized_caller_cannot_mint`, `test::the_compliance_authority_cannot_mint_burn_or_swap_the_rules` |
| `burn` | `#[only_role(operator, "manager")]` | Balance sufficient | `test::unauthorized_caller_cannot_burn` |
| `forced_transfer` | `#[only_role(operator, "manager")]` | Balance sufficient | `test::unauthorized_caller_cannot_forced_transfer`, `test::legal_transfer::compliance_no_longer_forces_transfers` |
| `legal_transfer` | `#[only_role(operator, "compliance")]` and the admin's `require_auth()` in the same call, from two different accounts (`CoSignRequired`) | Reference of 1–128 bytes (`InvalidReference`); never from or to the vault's address (`VaultAddress`); destination passes `verify_identity`; balance sufficient | `test::legal_transfer::*` |
| `set_address_frozen` | `#[only_role(operator, "compliance")]` | Never freezes the bound vault's address (`VaultAddress`); unfreezing it stays possible | `test::unauthorized_caller_cannot_freeze_or_recover`, `test::the_manager_escrows_but_does_not_intervene`, `test::legal_transfer::the_vault_address_cannot_be_frozen` |
| `freeze_partial_tokens` | `#[only_role(operator, "compliance")]` | Balance sufficient; never the bound vault's address (`VaultAddress`) | `test::unauthorized_caller_cannot_freeze_or_recover`, `test::the_manager_escrows_but_does_not_intervene`, `test::legal_transfer::the_vault_address_cannot_be_frozen` |
| `unfreeze_partial_tokens`| `#[only_role(operator, "compliance")]` | Frozen amount sufficient | `test::unauthorized_caller_cannot_freeze_or_recover`, `test::the_manager_escrows_but_does_not_intervene` |
| `recover_balance` | `#[only_role(operator, "compliance")]` and the admin's `require_auth()` in the same call, from two different accounts (`CoSignRequired`) | Never from or to the vault's address (`VaultAddress`); target allowlisted and named by the verifier's `recovery_target` (the testnet stub names none, so recovery always fails there) | `test::unauthorized_caller_cannot_freeze_or_recover`, `test::the_compliance_authority_reaches_recovery`, `test::legal_transfer::recovery_needs_the_admin_too`, `test::legal_transfer::recovery_never_takes_the_vault_balance`, `test::legal_transfer::recovery_never_lands_on_the_vault_address` |
| `set_compliance` | `#[only_admin]`, `operator.require_auth()` | Instant during setup; `UseTimelock` after | `test::unauthorized_caller_cannot_set_compliance_or_verifier`, `test::the_compliance_authority_cannot_mint_burn_or_swap_the_rules`, `test_governance::rule_and_verifier_swaps_wait_after_setup` |
| `set_identity_verifier` | `#[only_admin]`, `operator.require_auth()` | Instant during setup; `UseTimelock` after | `test::unauthorized_caller_cannot_set_compliance_or_verifier`, `test::the_compliance_authority_cannot_mint_burn_or_swap_the_rules`, `test_governance::rule_and_verifier_swaps_wait_after_setup` |
| `renounce_admin` | Refused always (`ShareTokenError::AdminRequired`) | None | `test::the_admin_cannot_renounce_itself_out_of_the_token`; `test::admin_handover_in_two_steps_still_works`; `test_governance::an_applied_admin_change_starts_a_hand_over_the_next_admin_accepts`. A token without an admin could never be unpaused or rotate its manager; hand over by proposing and applying an `Admin` change (`transfer_admin_role` during setup), then the nominee calls `accept_admin_transfer`. |
| `bind_vault` | `#[only_admin]`, `caller.require_auth()` | During setup, once; the vault must answer `timelock_clock` | `test_governance::a_second_vault_cannot_be_bound`, `test_governance::an_address_that_reports_no_clock_cannot_be_bound` |
| `finish_setup` | `#[only_admin]`, `caller.require_auth()` | Needs a bound vault and no pending admin hand-over; once | `test_governance::setup_is_open_until_finished_and_never_reopens`, `test_governance::setup_cannot_finish_while_a_hand_over_is_pending` |
| `propose_change` | `#[only_admin]`, `caller.require_auth()` | After setup; vault not winding down; one upgrade at a time | `test_governance::nothing_is_proposed_during_setup`, `test_governance::only_the_admin_proposes_cancels_and_applies` |
| `cancel_change` | `#[only_admin]`, `caller.require_auth()` | The change must be pending | `test_governance::only_the_admin_proposes_cancels_and_applies` |
| `apply_change` | `#[only_admin]`, `caller.require_auth()` | Delay run on the vault's clock, vault unpaused and not winding down, delay `>=` the vault's notice | `test_governance::a_vault_pause_moves_the_eta_and_holds_the_change`, `test_governance::a_change_shorter_than_a_raised_notice_never_lands` |
| `pending_changes` | Open view | None | None (view) |
| `grant_role` | Admin, `caller.require_auth()` | Instant during setup; `UseTimelock` after | `test_governance::grants_and_manager_revokes_wait_after_setup` |
| `revoke_role` | Admin, `caller.require_auth()` | `compliance`: instant. `manager`: instant during setup, `UseTimelock` after | `test_governance::grants_and_manager_revokes_wait_after_setup` (the instant case: `test_governance::revoking_compliance_stays_instant_after_setup`) |
| `transfer_admin_role` | Admin | Instant during setup; `UseTimelock` after. A zero `live_until_ledger` cancels at once | `test_governance::an_admin_hand_over_waits_but_cancelling_one_does_not` |
| `set_role_admin` | Refused always (`ShareTokenError::UseTimelock`) | None | `test_governance::no_role_ever_gets_a_role_admin`. A role admin could grant its role with no delay. |
| `upgrade` | Not exposed | Upgrades go through `propose_change(Upgrade)` | `test::upgrade::with_wasm::the_token_exposes_no_immediate_upgrade` in `contracts/async-vault` (needs `upgrade_wasm`): the built token refuses `upgrade` with a real uploaded hash because it exports no such function |

### 5.3 NavOracle (`contracts/nav-oracle`)

The oracle's `admin` is governance; its attester and guardian are constructor parameters. Until `finish_setup`, admin changes are instant. Setup cannot finish while an admin hand-over offered during setup is pending. After setup, the following wait for the vault's timelock through `propose_change`/`apply_change`: grants, admin hand-over, every `set_config` change except a shorter `freshness_duration`, and upgrades. Revoking `attester` or `guardian`, the NAV pause (`pause_nav`, `set_nav_paused`) and `clear_latest` stay instant.

Tests: [`contracts/nav-oracle/src/test.rs`](../contracts/nav-oracle/src/test.rs) and [`contracts/nav-oracle/src/test_governance.rs`](../contracts/nav-oracle/src/test_governance.rs).

| Entrypoint | Access Control / Caller Auth | State & Precondition Guards | Tested Refusal (Test Name) |
|---|---|---|---|
| `attest` | `#[only_role(caller, "attester")]` | Refused while the NAV is paused; cooldown, deviation cap, bounds `[min, max]`; expiry capped at the freshness window | `test::attest_is_role_gated`, `test::attesting_is_refused_while_the_nav_is_paused` |
| `pause_nav` | `#[only_role(caller, "guardian")]` | None; instant after setup too | `test::pausing_the_nav_is_limited_to_the_guardian` (the instant case: `test_governance::the_nav_pause_and_clearing_stay_instant_after_setup`) |
| `set_nav_paused` | `#[only_admin]`, `caller.require_auth()` | None; instant after setup too | `test::the_guardian_pauses_the_nav_but_unpausing_needs_governance` |
| `clear_latest` | `#[only_admin]`, `caller.require_auth()` | NAV must be paused; instant after setup too | `test::only_admin_can_clear_latest`, `test::the_record_clears_only_while_the_nav_is_paused` |
| `set_config` | `#[only_admin]` (no caller argument; the stored admin signs) | Valid bounds. Instant while setup is open, or when the change is only a shorter `freshness_duration`; `UseTimelock` otherwise. Applying a `Config` change sets every field, freshness included; to keep a cut made after the proposal, cancel the queued change and propose again | `test::only_admin_can_set_config`, `test_governance::a_tighter_cap_or_band_waits_after_setup`, `test_governance::a_config_that_tightens_one_field_and_loosens_another_waits`, `test_governance::a_shorter_freshness_window_with_a_looser_field_waits`, `test_governance::a_freshness_cut_below_the_cooldown_is_refused` |
| `renounce_admin` | Refused always (`OracleError::AdminRequired`) | None | `test::the_oracle_admin_cannot_renounce_itself_away`; `test_governance::an_applied_admin_change_starts_a_hand_over_the_next_admin_accepts`. An oracle without an admin could never be reconfigured, clear a stuck record or unpause the NAV; hand over by proposing and applying an `Admin` change (`transfer_admin_role` during setup), then the nominee calls `accept_admin_transfer`. |
| `bind_vault` | `#[only_admin]`, `caller.require_auth()` | During setup, once; the vault must answer `timelock_clock` | `test_governance::setup_is_open_until_finished_and_never_reopens`, `test_governance::a_second_vault_cannot_be_bound`, `test_governance::an_address_that_reports_no_clock_cannot_be_bound` |
| `finish_setup` | `#[only_admin]`, `caller.require_auth()` | Needs a bound vault and no pending admin hand-over; once | `test_governance::setup_is_open_until_finished_and_never_reopens`, `test_governance::setup_cannot_finish_while_a_hand_over_is_pending` |
| `propose_change` | `#[only_admin]`, `caller.require_auth()` | After setup; vault not winding down; one upgrade at a time; a `Config` change must pass the constructor's bounds | `test_governance::nothing_is_proposed_during_setup`, `test_governance::an_invalid_config_cannot_be_proposed`, `test_governance::only_the_admin_proposes_cancels_and_applies` |
| `cancel_change` | `#[only_admin]`, `caller.require_auth()` | The change must be pending | `test_governance::only_the_admin_proposes_cancels_and_applies` |
| `apply_change` | `#[only_admin]`, `caller.require_auth()` | Delay run on the vault's clock, vault unpaused and not winding down, delay `>=` the vault's notice; a `Config` change must still pass the bounds | `test_governance::a_vault_pause_moves_the_eta_and_holds_the_change`, `test_governance::nothing_is_proposed_or_applied_while_the_vault_winds_down`, `test_governance::a_change_shorter_than_a_raised_notice_never_lands`, `test_governance::a_config_outside_the_bounds_is_refused_when_it_applies` |
| `pending_changes` | Open view | None | None (view) |
| `grant_role` | Admin, `caller.require_auth()` | Instant during setup; `UseTimelock` after | `test_governance::grants_wait_after_setup_and_land_through_the_timelock` |
| `revoke_role` | Admin, `caller.require_auth()` | Instant: taking an attester or a guardian away moves no value | `test_governance::only_the_admin_revokes_a_role` (the instant case: `test_governance::revoking_an_attester_or_a_guardian_stays_instant_after_setup`) |
| `transfer_admin_role` | Admin | Instant during setup; `UseTimelock` after. A zero `live_until_ledger` cancels at once | `test_governance::an_admin_hand_over_waits_but_cancelling_one_does_not` |
| `set_role_admin` | Refused always (`OracleError::UseTimelock`) | None | `test_governance::no_role_ever_gets_a_role_admin`. A role admin could grant its role with no delay. |
| `upgrade` | Not exposed | Upgrades go through `propose_change(Upgrade)` | `test_governance::with_wasm::the_oracle_exposes_no_immediate_upgrade` (needs `upgrade_wasm`): the built oracle refuses `upgrade` with a real uploaded hash because it exports no such function |

### 5.4 IdentityVerifier (`contracts/identity-verifier`)

A testnet-only stub. Its admin is the compliance key and cannot be transferred: the stub exposes no access-control interface, so replacing the compliance key on it means redeploying.

Tests: [`contracts/identity-verifier/src/test.rs`](../contracts/identity-verifier/src/test.rs).

| Entrypoint | Access Control / Caller Auth | State & Precondition Guards | Tested Refusal (Test Name) |
|---|---|---|---|
| `allow` | `#[only_admin]` (the compliance key), `caller.require_auth()` | None | `test::only_admin_can_allow` |
| `verify_identity` | Open check (Internal hook) | `is_allowed(account) == true` | `test::verify_identity_checks_allowlist` |

### 5.5 Compliance (`contracts/compliance`)

A testnet-only stub. Its admin is governance. Module changes, token bindings and admin hand-overs are instant during setup and wait for the vault's timelock after `finish_setup`. Each admin call checks the stored admin's signature; its `operator` argument is not checked.

Tests: [`contracts/compliance/src/test/changes.rs`](../contracts/compliance/src/test/changes.rs).

| Entrypoint | Access Control / Caller Auth | State & Precondition Guards | Tested Refusal (Test Name) |
|---|---|---|---|
| `bind_vault` | `#[only_admin]` | During setup, once; the vault must answer `timelock_clock` | `test::changes::a_second_vault_or_a_late_vault_is_refused`, `test::changes::an_address_that_reports_no_clock_cannot_be_bound`, `test::changes::only_the_admin_binds_and_finishes` |
| `finish_setup` | `#[only_admin]` | Needs a bound vault and no pending admin hand-over; once | `test::changes::setup_cannot_finish_without_a_vault`, `test::changes::setup_cannot_finish_while_a_hand_over_is_pending`, `test::changes::a_second_vault_or_a_late_vault_is_refused` |
| `bind_token`, `unbind_token`, `add_module_to`, `remove_module_from` | `#[only_admin]` | Instant during setup; `UseTimelock` after | `test::changes::after_setup_rule_changes_wait_for_the_timelock` |
| `propose_change` | `#[only_admin]` | After setup; vault not winding down | `test::changes::proposals_wait_until_setup_is_finished`, `test::changes::only_the_admin_proposes_cancels_and_applies` |
| `cancel_change` | `#[only_admin]` | The change must be pending | `test::changes::a_cancelled_change_never_lands` |
| `apply_change` | `#[only_admin]` | Delay run on the vault's clock, vault unpaused and not winding down, delay `>=` the vault's notice | `test::changes::a_proposed_binding_lands_after_the_delay`, `test::changes::nothing_lands_while_the_vault_is_paused_or_winding_down`, `test::changes::a_vault_pause_pushes_the_change_back`, `test::changes::a_change_shorter_than_a_raised_notice_never_lands` |
| `pending_changes` | Open view | None | None (view) |
| `transfer_admin_role` | Admin | Instant during setup; `UseTimelock` after. A zero `live_until_ledger` cancels at once | `test::changes::only_the_admin_offers_or_cancels_a_hand_over`, `test::changes::after_setup_the_admin_hands_over_through_the_timelock`, `test::changes::a_cancelled_hand_over_no_longer_holds_setup_open`, `test::changes::a_hand_over_after_setup_is_cancelled_at_once` |
| `accept_admin_transfer` | The pending admin's auth | A hand-over is pending; an applied `Admin` change stays open for seven days of ledgers | `test::changes::only_the_nominee_accepts_a_hand_over`, `test::changes::setup_cannot_finish_while_a_hand_over_is_pending`, `test::changes::the_hand_over_offer_lasts_seven_days_of_ledgers` |
