# Strata Vault Kit Specification

This document is the authoritative kit reference for the Strata Vault Protocol. It provides a third party with everything needed to configure, deploy, and verify an instance without inspecting contract source code.

It covers:
1. **Core Invariants & Testable Properties**
2. **Deploy-Time Parameters & Runtime Configuration**
3. **Role & Authority Matrix (Privileges & Anti-Capabilities)**

---

## 1. Protocol Invariants & Testable Properties

The contracts enforce a set of mathematical and state-machine invariants across all operations. Each invariant is stated below as a formal, testable property matching the on-chain test suite and the TLA+ formal specifications in `spec/`.

### Invariant 1: Reserve Solvency
- **Definition**: The vault's on-chain asset balance must cover all pending cancellable subscription escrow and all committed redemption liabilities.
- **Mathematical Statement**:
  $$\text{liquid\_reserve} \ge \text{committed} + \text{cancellable\_escrow}$$
- **Testable Property**: For every state transition, the contract's actual balance held in the Stellar Asset Contract (SAC) is strictly $\ge \text{committed} + \text{cancellable\_escrow}$. The free reserve ($\text{liquid\_reserve} - \text{committed} - \text{cancellable\_escrow}$) cannot be negative.
- **Enforcement**: Outbound custodian transfers (`deploy_to_custodian`) check that only uncommitted, non-escrowed free reserve is movable.

### Invariant 2: Notice Period Respected
- **Definition**: An epoch cannot be fulfilled or priced until its standing notice period has fully elapsed.
- **Mathematical Statement**:
  $$\text{priceable\_at} = \text{closed\_at} + \text{notice}$$
  $$\text{fulfill\_epoch}(\text{epoch}) \implies \text{ledger.timestamp} \ge \text{priceable\_at}$$
- **Testable Property**: Invocations of `fulfill_epoch` before `priceable_at` are rejected with `NoticeNotElapsed`. Changing the notice period via `set_notice` applies only to future epochs and never shortens the notice of an already closed epoch.

### Invariant 3: Post-Close Valuation Timing
- **Definition**: An epoch is never priced against a valuation accepted before that epoch closed.
- **Mathematical Statement**:
  $$\text{attested\_at} \ge \text{closed\_at}$$
- **Testable Property**: If the latest oracle attestation timestamp precedes `closed_at`, `fulfill_epoch` is rejected with `ValuationPredatesClose`. A valuation accepted in the exact closing ledger timestamp or later is accepted.

### Invariant 4: Covered Claims Always Pay (Exit Guarantee)
- **Definition**: Once an exit is priced and covered by the liquid reserve, its cash payout cannot be blocked by an administrative pause, oracle staleness, or an investor's compliance delisting.
- **Testable Property**: If `liquid_reserve >= assets_owed`, `claim_redeem` succeeds when:
  1. The vault is paused (`paused == true`).
  2. The oracle feed has expired (`is_stale == true`) or ripcord is raised.
  3. The caller has been de-listed or frozen in the `IdentityVerifier`.
  Priced claims are never re-priced and never identity-gated.

### Invariant 5: Exit Rights Never Gated or Pausable
- **Definition**: Investors cannot be trapped in the vault by an administrative pause.
- **Testable Property**: When `paused == true`:
  - `request_deposit` is refused (`VaultError::ContractPaused`).
  - `request_redeem` succeeds and locks shares into escrow.
  - `claim_redeem` and `claim_deposit` remain open.

### Invariant 6: Single-Step Atomic Cancellation
- **Definition**: Cancellation is an all-or-nothing operation open only while an epoch cannot be priced.
- **Testable Property**:
  - While an epoch is `Open`, or `Pending` with `priceable_at > now` (or feed stale/paused), `cancel_deposit` and `cancel_redeem` return 100% of escrowed assets/shares atomically.
  - Once `now >= priceable_at` and a fresh attestation is available, cancellation is refused with `PriceAvailable`.
  - Once fulfilled, cancellation is refused with `AlreadyPriced`.

### Invariant 7: Directional Rounding & Non-Creation of Value
- **Definition**: Arithmetic conversions round in the vault's favor, preventing arbitrage and value creation from rounding residue.
- **Mathematical Statement**:
  $$\text{assets\_to\_shares}(a) = \lfloor (a \cdot \text{SCALE}) / \text{NAV} \rfloor$$
  $$\text{shares\_to\_assets}(s) = \lfloor (s \cdot \text{NAV}) / \text{SCALE} \rfloor$$
  $$\text{assets\_to\_shares}(\text{shares\_to\_assets}(s)) \le s$$
- **Testable Property**: For all values of $a, s \in [1, 10^{30}]$ and $\text{NAV} \in [\text{min\_answer}, \text{max\_answer}]$, round-trip conversion produces zero net value. Remainder satisfies:
  $$(a \cdot \text{SCALE}) - (s \cdot \text{NAV}) < \text{NAV}$$

### Invariant 8: Bounded Governance Timelocks
- **Definition**: Upgrades and wind-downs cannot execute without advance notice, and delays cannot be set to invalid boundaries.
- **Testable Property**:
  - Upgrade delay $\in [7 \text{ days}, 90 \text{ days}]$ and $\text{delay} \ge \text{notice}$.
  - Wind-down delay $\le 14 \text{ days}$.
  - Applying an upgrade before $\text{proposed\_time} + \text{delay}$ reverts with `UpgradeDelayNotElapsed`.
  - Pausing freezes the upgrade timelock clock and pushes the ETA by the duration paused.
  - Renouncing admin is permanently refused (`AdminRequired`).

### Invariant 9: Wind-Down Pro-Rata Solvency
- **Definition**: In an active wind-down, total round payouts across all share claims can never exceed the capital credited to that round.
- **Mathematical Statement**:
  $$\sum_{i} \text{payout}_i \le \text{round\_assets}$$
- **Testable Property**: In any distribution round with arbitrary share distributions and rounding remainders, the vault remains solvent for the last claimant. Active wind-down is strictly irreversible.

---

## 2. Deploy-Time Parameters & Runtime Configuration

Deploying the Strata Vault Kit involves five contracts configured via `environments.toml`. Parameters are split into immutable deploy-time constructor arguments and governance-tunable runtime settings.

### Deploy-Time Parameters (`constructor_args`)

| Contract | Parameter | Type / Units | Meaning & Constraints | Where Set |
|---|---|---|---|---|
| **`compliance`** | `admin` | `Address` | Administrator account for compliance configuration | `compliance.constructor_args` |
| **`identity_verifier`** | `admin` | `Address` | Administrator account authorized to update allowlist | `identity_verifier.constructor_args` |
| **`share_token`** | `name` | `String` | Human-readable token name (e.g. `"Strata Vault USDC"`) | `share_token.constructor_args` |
| **`share_token`** | `symbol` | `String` | Token ticker symbol (e.g. `"bvUSDC"`) | `share_token.constructor_args` |
| **`share_token`** | `admin` | `Address` | Token administrative multisig (Governance) | `share_token.constructor_args` |
| **`share_token`** | `manager` | `Address` | Authorized role for mint/burn/freeze hooks (Vault address) | `share_token.constructor_args` |
| **`share_token`** | `compliance` | `Address` | Address of deployed `compliance` contract | `share_token.constructor_args` |
| **`share_token`** | `identity_verifier` | `Address` | Address of deployed `identity_verifier` contract | `share_token.constructor_args` |
| **`nav_oracle`** | `admin` | `Address` | Oracle admin multisig (Governance) | `nav_oracle.constructor_args` |
| **`nav_oracle`** | `attester` | `Address` | Authorized reporter multisig for NAV attestations | `nav_oracle.constructor_args` |
| **`nav_oracle`** | `guardian` | `Address` | Guardian multisig authorized to raise ripcord | `nav_oracle.constructor_args` |
| **`nav_oracle`** | `config.freshness_duration` | `u64` (seconds) | Validity window of an attestation before it is stale ($> 0$) | `nav_oracle.constructor_args` |
| **`nav_oracle`** | `config.cooldown_secs` | `u64` (seconds) | Minimum time between consecutive price attestations | `nav_oracle.constructor_args` |
| **`nav_oracle`** | `config.max_up_bps` | `u32` (basis points) | Maximum allowable upward price jump (1 bps = 0.01%, $> 0$) | `nav_oracle.constructor_args` |
| **`nav_oracle`** | `config.max_down_bps` | `Option<u32>` (bps) | Maximum allowable downward jump (`null` = loss of any size allowed) | `nav_oracle.constructor_args` |
| **`nav_oracle`** | `config.min_answer` | `i128` (18 decimals) | Absolute floor price per share (cannot be zero or negative) | `nav_oracle.constructor_args` |
| **`nav_oracle`** | `config.max_answer` | `i128` (18 decimals) | Absolute ceiling price per share ($\ge \text{min\_answer}$) | `nav_oracle.constructor_args` |
| **`async_vault`** | `asset` | `Address` | Settlement asset SAC contract address (e.g. USDC) | `async_vault.constructor_args` |
| **`async_vault`** | `share_token` | `Address` | Deployed share token contract address | `async_vault.constructor_args` |
| **`async_vault`** | `oracle` | `Address` | Deployed NAV oracle contract address | `async_vault.constructor_args` |
| **`async_vault`** | `roles.governance` | `Address` | Governance multisig authority | `async_vault.constructor_args` |
| **`async_vault`** | `roles.treasury` | `Address` | Treasury multisig authority | `async_vault.constructor_args` |
| **`async_vault`** | `roles.guardian` | `Address` | Guardian multisig authority | `async_vault.constructor_args` |
| **`async_vault`** | `roles.manager` | `Address` | Manager authority (closes epochs) | `async_vault.constructor_args` |
| **`async_vault`** | `roles.compliance` | `Address` | Compliance multisig authority | `async_vault.constructor_args` |
| **`async_vault`** | `roles.attester` | `Address` | Attestation authority (mirrors oracle reporter) | `async_vault.constructor_args` |

#### Pairwise Role Separation Enforced at Construction
The `async_vault` constructor strictly verifies pairwise separation across authorities:
- `treasury != guardian`
- `treasury != governance`
- `compliance != governance`
- `compliance != treasury`

---

### Runtime Parameters (Governance-Tunable)

| Parameter | Method | Authority | Constraints & Defaults |
|---|---|---|---|
| **Standing Notice** | `set_notice(secs: u64)` | Governance | Notice wait before pricing. Default: `0`. Must satisfy $\text{secs} \le \text{upgrade\_delay}$ and $\text{secs} \le 14 \text{ days}$. |
| **Custodian Address** | `set_custodian(custodian: Address)` | Governance | Recipient address for off-chain capital deployment. Required before `deploy_to_custodian`. |
| **Deposit Cap** | `set_deposit_cap(cap: Option<i128>)` | Governance | Maximum capacity for deposited capital. `None` = unbounded. Refuses negative cap. |
| **Wind-Down Delay** | `set_wind_down_delay(secs: u64)` | Governance | Minimum notice before wind-down activation. Default: `0`. Capped at 14 days (`MAX_WIND_DOWN_DELAY`). |
| **Upgrade Delay** | `propose_upgrade_delay(secs: u64)` | Governance | Timelock delay for wasm upgrades. Must be $\ge 7 \text{ days}$, $\le 90 \text{ days}$, and $\ge \text{notice}$. |
| **Oracle Configuration** | `set_config(config: OracleConfig)` | Governance | Updates oracle parameters. Follows same validation rules as constructor. |

---

## 3. Role & Authority Matrix

Strata distributes control across five native Stellar multisig authorities and permissionless public entrypoints. Every privileged function is mapped to exactly one authority.

### Authority Capabilities & Anti-Capabilities

| Authority | Quorum / Profile | Authorized Capabilities | Anti-Capabilities (What It Cannot Do) |
|---|---|---|---|
| **Governance** | High-quorum deliberative multisig | Set parameters (`notice`, `custodian`, `deposit_cap`, `wind_down_delay`), propose/apply upgrades, propose/cancel wind-down, unpause, transfer admin. | **Cannot pause directly**; cannot move funds; cannot initiate custodian transfers; cannot attest prices; cannot bypass timelocks. |
| **Guardian** | Low-threshold fast-reaction multisig | `pause` (vault); `raise_ripcord` (oracle emergency price freeze). | **Cannot unpause**; cannot move funds; cannot block redemption requests; cannot block payable claims or cancellations. |
| **Treasury** | Operational capital multisig | `deploy_to_custodian` (moves free reserve); `fund` (returns assets from custodian). | **Cannot deploy while anything is uncovered**; cannot touch escrowed subscription assets; cannot alter parameters or pause. |
| **Attester** | High-security attestation multisig | `attest` (submits NAV report with proof reference). | **Cannot price outside deviation band**; cannot violate cooldown; cannot operate on the vault directly. |
| **Compliance** | Legal / KYC operator multisig | Manage allowlist (`allow`), topic claims; token interventions (`freeze`, `forced_transfer`, `recovery`). | **Cannot touch vault reserve**; cannot pause vault operations; cannot bypass exit-only cash redemptions. |
| **Manager** | Operational keeper account / vault | `close_epoch` (vault); `mint`, `burn`, `forced_transfer` (share token). | **Cannot choose prices**; cannot prevent epoch fulfillment; cannot alter timelocks. |
| **Permissionless** | Any caller / keeper / investor | `fulfill_epoch`, `request_deposit`, `cancel_deposit`, `claim_deposit`, `request_redeem`, `cancel_redeem`, `claim_redeem`, `activate_wind_down`, `finalize_wind_down_round`, `claim_wind_down`. | Operations are strictly constrained by contract state, timing, and solvency guards. |

---

### Comprehensive Entrypoint Permission Matrix

| Contract | Entrypoint | Calling Authority | Access Control Guard | Pausable? |
|---|---|---|---|---|
| **`AsyncVault`** | `request_deposit` | Investor (Caller) | `from.require_auth()` | Yes (halted by pause) |
| **`AsyncVault`** | `cancel_deposit` | Investor (Caller) | `from.require_auth()` | No (open during pause) |
| **`AsyncVault`** | `claim_deposit` | Investor (Caller) | `caller.require_auth()` | No (open during pause) |
| **`AsyncVault`** | `request_redeem` | Investor (Caller) | `from.require_auth()` | No (always open) |
| **`AsyncVault`** | `cancel_redeem` | Investor (Caller) | `from.require_auth()` | No (open during pause) |
| **`AsyncVault`** | `claim_redeem` | Investor (Caller) | `caller.require_auth()` | No (always open) |
| **`AsyncVault`** | `close_epoch` | Manager | `#[only_role(caller, "manager")]` | No |
| **`AsyncVault`** | `fulfill_epoch` | Permissionless | None | Yes (halted by pause) |
| **`AsyncVault`** | `pause` | Guardian | `#[only_role(caller, "guardian")]` | N/A |
| **`AsyncVault`** | `unpause` | Governance | `#[only_admin]` | N/A |
| **`AsyncVault`** | `set_notice` | Governance | `#[only_admin]` | No |
| **`AsyncVault`** | `set_custodian` | Governance | `#[only_admin]` | No |
| **`AsyncVault`** | `set_deposit_cap` | Governance | `#[only_admin]` | No |
| **`AsyncVault`** | `set_wind_down_delay` | Governance | `#[only_admin]` | No |
| **`AsyncVault`** | `propose_wind_down` | Governance | `#[only_admin]` | No |
| **`AsyncVault`** | `cancel_wind_down_proposal` | Governance | `#[only_admin]` | No |
| **`AsyncVault`** | `activate_wind_down` | Permissionless | None (requires timelock elapsed) | No |
| **`AsyncVault`** | `finalize_wind_down_round` | Permissionless | None | No |
| **`AsyncVault`** | `claim_wind_down` | Shareholder (Caller) | `caller.require_auth()` | No |
| **`AsyncVault`** | `deploy_to_custodian` | Treasury | `#[only_role(caller, "treasury")]` | No (open during pause) |
| **`AsyncVault`** | `fund` | Treasury | None (caller transfers funds) | No |
| **`AsyncVault`** | `propose_upgrade` | Governance | `#[only_admin]` | No |
| **`AsyncVault`** | `propose_upgrade_delay` | Governance | `#[only_admin]` | No |
| **`AsyncVault`** | `cancel_upgrade` | Governance | `#[only_admin]` | No |
| **`AsyncVault`** | `apply_upgrade` | Governance | `#[only_admin]` | Refused if paused |
| **`AsyncVault`** | `transfer_admin_role` | Governance | `#[only_admin]` | No |
| **`AsyncVault`** | `accept_admin_transfer` | Proposed Admin | `caller.require_auth()` | No |
| **`NavOracle`** | `attest` | Attester | `#[only_role(caller, "attester")]` | Refused if ripcord active |
| **`NavOracle`** | `raise_ripcord` | Guardian | `#[only_role(caller, "guardian")]` | N/A |
| **`NavOracle`** | `set_ripcord` | Governance | `#[only_admin]` | N/A |
| **`NavOracle`** | `set_config` | Governance | `#[only_admin]` | No |
| **`NavOracle`** | `clear_latest` | Governance | `#[only_admin]` (requires ripcord) | No |
| **`ShareToken`** | `mint` | Manager (Vault) | `#[only_role(caller, "manager")]` | Respects token pause |
| **`ShareToken`** | `burn` | Manager (Vault) | `#[only_role(caller, "manager")]` | Respects token pause |
| **`ShareToken`** | `forced_transfer` | Manager (Compliance) | `#[only_role(caller, "manager")]` | Bypasses token pause |
| **`ShareToken`** | `set_address_frozen` | Manager (Compliance) | `#[only_role(caller, "manager")]` | No |
| **`IdentityVerifier`** | `allow` | Admin (Compliance) | `#[only_admin]` | No |
| **`IdentityVerifier`** | `set_claim_topics_and_issuers`| Admin (Compliance) | `#[only_admin]` | No |

---

## 4. Deployment Runbook Summary

A clean deployment executes in three sequenced phases:

1. **Phase 1: Contract Deployment**
   - Deploy `compliance`, `identity_verifier`, `share_token`, `nav_oracle`, and `async_vault` with constructor arguments matching `environments.toml`.
2. **Phase 2: Post-Deployment Role Wiring**
   - Call `ShareToken::grant_role("manager", vault_address)` to authorize lazy share minting and burning.
   - Call `IdentityVerifier::allow(vault_address, true)` so the vault can return escrowed shares on cancelled redemptions.
   - Call `Compliance::bind_token(share_token_address)` to link SEP-57 rule verification.
3. **Phase 3: Operational Parameterization**
   - Governance calls `set_notice(secs)` and `set_custodian(custodian_address)`.
   - Governance sets `deposit_cap` if initial capital intake is bounded.
   - Oracle reporter submits the genesis NAV attestation (`attest`).
