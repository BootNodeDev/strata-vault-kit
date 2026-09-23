# Authorization & Access Control Matrix

This document provides the complete authorization and role model specification for the Strata Vault Kit across all four contracts (`AsyncVault`, `ShareToken`, `NavOracle`, and `IdentityVerifier`), satisfying the audit requirements of Issue #78.

---

## 1. Architectural Principles

1. **Direct Role Membership Checks ($O(1)$)**: Role membership is checked directly via `has_role(e, &caller, &role)` or `stellar_macros::only_role` / `only_admin`, never by enumerating members.
2. **Strict Caller Authentication**: No entrypoint takes a caller argument that it does not authenticate. Every function accepting a `caller: Address` executes `caller.require_auth()`.
3. **Exit-Only Guarantee**: A covered redemption claim always pays out cash, regardless of pause, staleness, or allowlist status. Delisted or frozen investors exit through the cash path and are prevented from re-entering share circulation.
4. **Five Separate Authorities**:
   - **Governance (Admin)**: Root authority; upgrades, timelock parameters, custodian settings, unpause, oracle parameters, emergency ripcord reset.
   - **Manager (Vault)**: Closes epochs.
   - **Treasury**: Deploys free reserve assets to custodian.
   - **Guardian**: Emergency responder; pauses vault entries, raises oracle ripcord.
   - **Attester (Oracle)**: Submits off-chain valuation reports within strict deviation and rate bounds.
   - **Compliance / Identity**: External registry managing allowlists and transfer restrictions.

---

## 2. The Dual `manager` Roles Distinction

The symbol `"manager"` names two completely distinct roles living on separate contracts with separate privileges:

| Contract | Role Symbol | Held By | Scope & Privileges |
|---|---|---|---|
| **`AsyncVault`** | `symbol_short!("manager")` | Operator Multisig / Automation Bot | Strictly calls `close_epoch` to freeze orders for pricing. Holds **no** token minting or burning power. |
| **`ShareToken`** | `symbol_short!("manager")` | `AsyncVault` Contract Instance | Authorized to call `mint` (claim deposits), `burn` (claim redemptions), `forced_transfer` (escrow redemptions), and compliance operations. |

### Deployment Script Safety
In `scripts/harness/deploy.ts` and automated deployment scripts, the separation is enforced structurally:
- The vault's constructor receives `roles.manager = accounts.manager.publicKey()`.
- The share token role is granted to the deployed vault contract: `token.grant_role({ account: asyncVault.address, role: "manager", caller: governance })`.
- A misconfiguration attempting to grant `accounts.manager` the token manager role is prevented by verification assertions checking `token.has_role({ account: vault, role: "manager" }) == true`.

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
| **`AsyncVault`** | `claim_wind_down` | Open (for `holder`) | Callable by the holder or a third-party keeper acting on the holder's behalf; payouts always go directly to `holder`. |
| **`AsyncVault`** | `request_deposit` | `from.require_auth()` | Investor entrypoint. Deposits escrowed cash; guarded by `when_not_paused` and not winding down. |
| **`AsyncVault`** | `claim_deposit` | `caller.require_auth()` | Investor entrypoint. Claims shares once epoch fulfilled; gated by SEP-57 receiver check on `mint`. |
| **`AsyncVault`** | `cancel_deposit` | `from.require_auth()` | Investor exit before epoch pricing. Single-step refund. |
| **`AsyncVault`** | `request_redeem` | `from.require_auth()` | Investor exit. Always open, even during pause. |
| **`AsyncVault`** | `claim_redeem` | `caller.require_auth()` | Investor exit. Pays settlement asset once covered. |
| **`AsyncVault`** | `cancel_redeem` | `from.require_auth()` | Investor exit before epoch pricing. Returns escrowed shares. |

---

## 5. Complete Access Control Matrix Across All 4 Contracts

### 5.1 AsyncVault (`contracts/async-vault`)

| Entrypoint | Access Control / Caller Auth | State & Precondition Guards | Tested Refusal (Test Name) |
|---|---|---|---|
| `close_epoch` | `#[only_role(caller, "manager")]` | Epoch must be open | `test::epochs::admin_cannot_close_epoch`, `test::epochs::unauthorized_close_epoch_fails` |
| `deploy_to_custodian` | `#[only_role(caller, "treasury")]` | `assets <= free_reserve`, not winding down | `test::treasury::deploying_without_treasury_role_is_refused` |
| `pause` | `#[only_role(caller, "guardian")]` | Contract not already paused | `test::controls::the_guardian_pauses_and_unauthorised_cannot` |
| `unpause` | `#[only_admin]`, `caller.require_auth()` | Contract must be paused | `test::controls::the_guardian_pauses_but_only_governance_unpauses` |
| `set_custodian` | `#[only_admin]`, `caller.require_auth()` | None | `test::treasury::setting_the_custodian_needs_the_admin_signature` |
| `set_notice` | `#[only_admin]`, `caller.require_auth()` | `secs <= MAX_NOTICE_SECS`, `secs <= upgrade_delay` | `test::notice::setting_the_notice_needs_governance_authorisation` |
| `set_wind_down_delay` | `#[only_admin]`, `caller.require_auth()` | `secs <= MAX_WIND_DOWN_DELAY`, not active | `test::wind_down::only_governance_sets_the_delay` |
| `propose_wind_down` | `#[only_admin]`, `caller.require_auth()` | No proposal standing, not active | `test::wind_down::only_governance_proposes` |
| `cancel_wind_down_proposal` | `#[only_admin]`, `caller.require_auth()` | Must be proposed, not active | `test::wind_down::governance_cancels_a_proposal_before_activation` |
| `propose_upgrade` | `#[only_admin]`, `caller.require_auth()` | No proposal standing, delay >= notice | `test::upgrade::only_governance_proposes_and_cancels` |
| `propose_upgrade_delay` | `#[only_admin]`, `caller.require_auth()` | `secs in [MIN, MAX]`, `secs >= notice` | `test::upgrade::only_governance_proposes_and_cancels` |
| `cancel_upgrade` | `#[only_admin]`, `caller.require_auth()` | Proposal must stand | `test::upgrade::only_governance_proposes_and_cancels` |
| `apply_upgrade` | `#[only_admin]`, `caller.require_auth()` | Timelock expired, `when_not_paused` | `test::upgrade::only_governance_applies` |
| `renounce_admin` | Refused always (`VaultError::AdminRequired`) | None | `test::upgrade::the_vault_admin_cannot_renounce` |

### 5.2 ShareToken (`contracts/share-token`)

| Entrypoint | Access Control / Caller Auth | State & Precondition Guards | Tested Refusal (Test Name) |
|---|---|---|---|
| `pause` | `#[only_admin]`, `caller.require_auth()` | Not paused | `test::unauthorized_caller_cannot_pause_or_unpause` |
| `unpause` | `#[only_admin]`, `caller.require_auth()` | Paused | `test::unauthorized_caller_cannot_pause_or_unpause` |
| `mint` | `#[only_role(operator, "manager")]` | Receiver allowlisted | `test::unauthorized_caller_cannot_mint` |
| `burn` | `#[only_role(operator, "manager")]` | Balance sufficient | `test::unauthorized_caller_cannot_burn` |
| `forced_transfer` | `#[only_role(operator, "manager")]` | Balance sufficient | `test::unauthorized_caller_cannot_forced_transfer` |
| `set_address_frozen` | `#[only_role(operator, "manager")]` | None | `test::unauthorized_caller_cannot_freeze_or_recover` |
| `freeze_partial_tokens` | `#[only_role(operator, "manager")]` | Balance sufficient | `test::unauthorized_caller_cannot_freeze_or_recover` |
| `unfreeze_partial_tokens`| `#[only_role(operator, "manager")]` | Frozen amount sufficient | `test::unauthorized_caller_cannot_freeze_or_recover` |
| `recover_balance` | `#[only_role(operator, "manager")]` | Target allowlisted | `test::unauthorized_caller_cannot_freeze_or_recover` |
| `set_compliance` | `#[only_role(operator, "manager")]` | None | `test::unauthorized_caller_cannot_set_compliance_or_verifier` |
| `set_identity_verifier` | `#[only_role(operator, "manager")]` | None | `test::unauthorized_caller_cannot_set_compliance_or_verifier` |

### 5.3 NavOracle (`contracts/nav-oracle`)

| Entrypoint | Access Control / Caller Auth | State & Precondition Guards | Tested Refusal (Test Name) |
|---|---|---|---|
| `attest` | `#[only_role(caller, "attester")]` | Cooldown, deviation cap, bounds `[min, max]` | `test::attest_is_role_gated` |
| `raise_ripcord` | `#[only_role(caller, "guardian")]` | None | `test::raising_the_ripcord_is_limited_to_the_guardian` |
| `set_ripcord` | `#[only_admin]`, `caller.require_auth()` | None | `test::the_guardian_raises_the_ripcord_but_lowering_needs_governance` |
| `clear_latest` | `#[only_admin]`, `caller.require_auth()` | Ripcord must be raised | `test::only_admin_can_clear_latest`, `test::the_record_clears_only_while_the_ripcord_is_raised` |
| `set_config` | `#[only_admin]`, `caller.require_auth()` | Valid bounds | `test::only_admin_can_set_config` |
| `renounce_admin` | Refused always (`OracleError::AdminRequired`) | None | `test::the_oracle_admin_cannot_renounce_itself_away` |

### 5.4 IdentityVerifier (`contracts/identity-verifier`)

| Entrypoint | Access Control / Caller Auth | State & Precondition Guards | Tested Refusal (Test Name) |
|---|---|---|---|
| `allow` | `#[only_admin]`, `caller.require_auth()` | None | `test::only_admin_can_allow` |
| `verify_identity` | Open check (Internal hook) | `is_allowed(account) == true` | `test::verify_identity_checks_allowlist` |
