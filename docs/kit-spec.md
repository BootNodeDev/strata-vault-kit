# Strata Vault Kit Specification

This document is the authoritative kit reference for the Strata Vault Protocol. It provides a third party with everything needed to configure, deploy, and verify an instance without inspecting contract source code.

It covers:
1. **Core Invariants & Testable Properties**
2. **Deploy-Time Parameters & Runtime Configuration**
3. **Role & Authority Matrix (Privileges & Anti-Capabilities)**

---

## 1. Protocol Invariants & Testable Properties

The contracts enforce a set of mathematical and state-machine invariants across all operations. Each invariant is stated below as a formal, testable property matching the on-chain test suite.

### Invariant 1: Escrow Stays, Only Free Reserve Moves
- **Definition**: Cancellable subscription escrow never leaves the vault, and only the free reserve can move to the custodian. Priced redemption liabilities (`committed`) may exceed the liquid reserve; the shortfall is reported as `uncovered`, not refused. Here $\text{held}$ is the vault's balance of the settlement asset.
- **Mathematical Statement**:
  $$\text{liquid\_reserve} = \text{held} - \text{cancellable\_escrow}$$
  $$\text{free\_reserve} = \max(\text{liquid\_reserve} - \text{committed} - \text{wind\_down\_owed}, 0)$$
  $$\text{uncovered} = \max(\text{committed} - \text{liquid\_reserve}, 0)$$
- **Testable Property**: `deploy_to_custodian(assets)` is refused with `ReserveCommittedToExits` when $\text{assets} > \text{free\_reserve}$, so after every operation $\text{held} \ge \text{cancellable\_escrow}$. While $\text{uncovered} > 0$, the free reserve is zero and nothing leaves for the custodian.
- **Enforcement**: `deploy_to_custodian` is the only outbound path to the custodian, and it moves at most the free reserve.

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
- **Testable Property**: If the latest oracle attestation timestamp precedes `closed_at`, `fulfill_epoch` is rejected with `AttestationBeforeClose`. A valuation accepted in the exact closing ledger timestamp or later is accepted.
  `attested_at` is the ledger time the oracle accepted the report, not a valuation date: the reporter's own `timestamp` is ignored. So "accepted before the close" compares acceptance time. The reporter's `expires_at` can only shorten a report's life: the oracle stores `min(expires_at, attested_at + freshness_duration)`.

### Invariant 4: Covered Claims Always Pay (Exit Guarantee)
- **Definition**: Once an exit is priced and covered by the liquid reserve, its cash payout cannot be blocked by an administrative pause, oracle staleness, or an investor's compliance delisting.
- **Testable Property**: If `liquid_reserve >= assets_owed`, `claim_redeem` succeeds when:
  1. The vault is paused (`paused == true`).
  2. The oracle feed has expired (`is_stale == true`) or the NAV is paused.
  3. The caller has been de-listed in the `IdentityVerifier`.
  Priced claims are never re-priced, and a cash payout never needs the identity check. A frozen investor's covered claim is held until the freeze is lifted (`VaultError::Frozen`); the cash stays in `committed`.

### Invariant 5: Exit Rights Never Gated or Pausable
- **Definition**: Investors cannot be trapped in the vault by a vault pause.
- **Testable Property**: When the vault is paused (`paused == true`):
  - `request_deposit` is refused by `#[when_not_paused]` (`PausableError::EnforcedPause`).
  - `request_redeem` succeeds and locks shares into escrow.
  - `claim_redeem` and `claim_deposit` remain open.
  - `cancel_redeem` remains open. Outside a wind-down, a delisted holder, or one the compliance rules refuse, exits through the cash claim instead; in a wind-down the escrow is surrendered. A frozen holder is held (Invariant 6).
  - `cancel_deposit` and `cancel_redeem` stay open for a sealed epoch while the vault is paused, because a paused vault cannot price it (Invariant 6).

### Invariant 6: Single-Step Atomic Cancellation
- **Definition**: Cancellation is all-or-nothing, and it is open exactly while the vault could not price the epoch now. Three rules decide it:
  1. A readable price closes cancellation, even while the notice still runs. A price is readable when the feed is valid and its report was accepted at or after the epoch closed.
  2. If the vault can no longer price the epoch — the report expires, the NAV is paused, or the vault is paused — cancellation opens again. That is the way out of a stalled feed, so escrow is never stuck. An investor cannot cause the reopening; only a lapsed attester, a raised NAV pause, or a paused vault can.
  3. The epoch is priced at the latest valid report at fulfil time that was accepted at or after the close — not necessarily the report that first closed the window.
- **Testable Property**:
  - While an epoch is `Open`, or `Pending` with no readable price or with the vault paused, `cancel_deposit` and `cancel_redeem` return 100% of the escrow.
  - A readable price refuses cancellation with `PriceAvailable`, even before `priceable_at`; once that report expires, cancellation works again (`cancellation_reopens_when_the_price_that_closed_it_expires`).
  - Pausing the vault reopens cancellation; unpausing closes it again while the price is still readable (`a_paused_vault_reopens_cancellation_of_an_epoch_it_could_price`).
  - Outside a wind-down, `cancel_redeem` refuses a delisted holder (`NotAllowlisted`) and a move the compliance rules refuse (`HolderNotEligible`); the request stays pending and the cash claim remains open. It holds a frozen holder (`Frozen`): the request stays pending, and its cash claim is held too until the freeze is lifted. Neither the share token's transfer pause nor the vault's own allowlist place stops a cancellation (`a_token_pause_stops_trading_but_not_a_share_return`, `a_delisted_vault_still_returns_escrowed_shares`).
  - In an active wind-down, `cancel_redeem` never returns shares: the escrow joins the holder's wind-down entitlement (`RedemptionSurrendered`), whether the holder is allowlisted or not. A frozen holder's escrow stays until the freeze is lifted.
  - Once fulfilled, cancellation is refused with `AlreadyPriced`.
- **Operating note**: keep `freshness_duration` longer than the notice, so a normal epoch's price does not lapse and reopen the window on its own.

### Invariant 7: Directional Rounding & Non-Creation of Value
- **Definition**: Arithmetic conversions round in the vault's favor, preventing arbitrage and value creation from rounding residue.
- **Mathematical Statement**:
  $$\text{assets\_to\_shares}(a) = \lfloor (a \cdot \text{SCALE}) / \text{NAV} \rfloor$$
  $$\text{shares\_to\_assets}(s) = \lfloor (s \cdot \text{NAV}) / \text{SCALE} \rfloor$$
  $$\text{assets\_to\_shares}(\text{shares\_to\_assets}(s)) \le s$$
- **Testable Property**: For all values of $a, s \in [1, 10^{30}]$ and $\text{NAV} \in [\text{min\_answer}, \text{max\_answer}]$, a round-trip conversion never creates value. Remainder satisfies:
  $$(a \cdot \text{SCALE}) - (s \cdot \text{NAV}) < \text{NAV}$$
- **Settlement**: pricing records what each epoch promised (`shares_promised`, `assets_promised`, see `get_epoch_settlement`). Claims floor one by one, so together they pay at most that. When the last request of a priced epoch settles, the remainder leaves `pending_mint_shares` and `committed` and the vault publishes `EpochReconciled { epoch, share_dust, cash_dust }`. The cash stays in the reserve, owed to nobody, and reaches every holder through the NAV. A running total that would go below zero fails with `AccountingMismatch` (6070) instead of clamping.
- **A request that can never settle** keeps its epoch open, and the two cases leave different amounts behind. A zero-asset redemption whose holder may not take the shares back (`HolderNotEligible`, `a_request_that_cannot_settle_keeps_its_epoch_open`) leaves only the epoch's ordinary rounding remainder in `committed` — fewer units than the epoch had redemption requests — because that request was never owed any cash. A priced deposit whose mint a compliance module refuses (`a_refused_mint_keeps_a_priced_deposit_epoch_open`) is not rounding dust: the mint reverts, so that deposit's whole share entitlement stays in `pending_mint_shares`, on top of the epoch's own remainder, until the mint is allowed. Either way it is still owed to nobody.

**Settlement and upgrades.** The settlement record counts a request only from the moment it exists. A vault upgraded in place to this version while any request is open would under-count its open epochs: claims in epochs priced before the upgrade would revert, and a mixed epoch could reconcile early. This version must therefore be deployed fresh, or reached by upgrade only once no request is open anywhere in the vault.

### Invariant 8: Bounded Governance Timelocks
- **Definition**: Upgrades and wind-downs cannot execute without advance notice, and delays cannot be set to invalid boundaries.
- **Testable Property**:
  - Upgrade delay $\in [7 \text{ days}, 90 \text{ days}]$ and $\text{delay} \ge \text{notice}$, checked when a delay change is proposed and again when it applies.
  - Wind-down delay $\in [7 \text{ days}, 90 \text{ days}]$ (`WindDownDelayTooShort`, `WindDownDelayTooLong`); 7 days when none was set.
  - The vault takes no deposit until its one-time setup closes (`SetupOpen`). `finish_setup` refuses with `SetupIncomplete` until the share token and the oracle report this vault with their own setup closed, the vault is the token's only `manager`, the token has no shares outstanding, the vault passes the token's identity check, the token has not frozen the vault's address, and the token is bound to its compliance contract. It also needs the asset to have the token's decimals, four different addresses for the asset, the token, the oracle and the vault, an oracle that answers `state()` and `freshness_duration()`, and a custodian other than the vault. A compliance contract that answers `vault()` and `setup_open()` must report this vault with its own setup closed; one that does not answer them is an external module and is accepted. Shares minted before setup closes would redeem against depositors' money. It refuses with `AdminTransferPending` while an admin hand-over offered during setup is pending. Setup never reopens (`SetupClosed`).
  - After setup, the vault's custodian, role grants, revoking `manager`, admin hand-overs and lowering the notice or the wind-down delay go through the queue; a direct call is refused with `UseTimelock`. Raising the notice or the wind-down delay, the deposit cap, `pause`/`unpause` and revoking any other role stay instant. A `Notice` or `WindDownDelay` change is checked against its bounds when proposed and again when it applies.
  - Every change waits in the queue (`propose_change` → `apply_change`). Applying before its eta reverts with `ChangeNotReady`.
  - A change whose delay is shorter than the notice standing at apply time reverts with `UpgradeDelayBelowNotice`.
  - Time spent paused does not count. Applying while paused is refused.
  - Nothing is proposed or applied during an active wind-down (`WindDownActive`).
  - One code change (upgrade or upgrade delay) waits at a time (`UpgradeProposalExists`).
  - Renouncing admin is permanently refused (`AdminRequired`).
  - Once its one-time setup closes, the share token's upgrades, grants, `manager` revocations, admin hand-overs and compliance or verifier swaps wait on the vault's clock under the same rules; a direct call is refused with `UseTimelock`. Revoking `compliance` stays instant.
  - Once its one-time setup closes, the oracle's upgrades, grants, admin hand-overs and every config change except a shorter `freshness_duration` wait on the vault's clock under the same rules; a direct call is refused with `UseTimelock`. Revoking `attester` or `guardian`, the NAV pause and `clear_latest` stay instant.
  - Once its one-time setup closes, the compliance contract's module changes, token bindings and admin hand-overs wait on the vault's clock under the same rules; a direct call is refused with `UseTimelock`.

### Invariant 9: Wind-Down Pro-Rata Solvency
- **Definition**: In an active wind-down, total round payouts across all share claims can never exceed the capital credited to that round.
- **Mathematical Statement**:
  $$\sum_{i} \text{payout}_i \le \text{round\_assets}$$
- **Testable Property**: In any distribution round with arbitrary share distributions and rounding remainders, the vault remains solvent for the last claimant. Active wind-down is strictly irreversible.
- An escrowed redemption cancelled during the wind-down counts toward the holder's entitlement, and so does a priced deposit a delisted holder claims. Credited before the first round, those shares count in its supply snapshot (`a_credit_before_the_first_round_leaves_every_holder_their_share`).
- During an active wind-down, a priced redemption whose claim pays nothing burns its escrowed shares instead of returning them, because the snapshot left them out (`a_redemption_that_pays_nothing_returns_no_shares_in_a_wind_down`).
- Each payout floors per holder. Once every holder whose shares were all surrendered has claimed, `wind_down_owed` keeps less than one unit per such holder, plus whatever value the snapshot counted in shares that never actually minted (for example `pending_mint_shares` from an epoch that promised more shares than it later minted). That remainder is not released: a later round lets each holder's floor catch up and needs it (`a_later_round_needs_the_units_an_earlier_round_left_in_owed`, `after_every_holder_claims_owed_keeps_at_most_one_unit_per_holder`, `owed_stays_below_the_holder_count_once_every_share_is_surrendered`).

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
| **`share_token`** | `compliance_authority` | `Address` | Compliance multisig; receives the `compliance` role for freezes, plus legal transfers and recovery with governance's co-signature. The vault's `manager` role is granted after deploy | `share_token.constructor_args` |
| **`share_token`** | `compliance` | `Address` | Address of deployed `compliance` contract | `share_token.constructor_args` |
| **`share_token`** | `identity_verifier` | `Address` | Address of deployed `identity_verifier` contract | `share_token.constructor_args` |
| **`nav_oracle`** | `admin` | `Address` | Oracle admin multisig (Governance) | `nav_oracle.constructor_args` |
| **`nav_oracle`** | `attester` | `Address` | Authorized reporter multisig for NAV attestations | `nav_oracle.constructor_args` |
| **`nav_oracle`** | `guardian` | `Address` | Guardian multisig authorized to pause the NAV | `nav_oracle.constructor_args` |
| **`nav_oracle`** | `config.freshness_duration` | `u64` (seconds) | Validity window of an attestation before it is stale; from 1 s to 35 days (`MAX_FRESHNESS_SECS`) | `nav_oracle.constructor_args` |
| **`nav_oracle`** | `config.cooldown_secs` | `u64` (seconds) | Minimum time between consecutive attestations. At least 1 s (`MIN_COOLDOWN_SECS`), so at most one report per ledger. At most `freshness_duration`, so a new report can always replace the last one before the freshness window ends | `nav_oracle.constructor_args` |
| **`nav_oracle`** | `config.max_up_bps` | `u32` (basis points) | Largest upward move per attestation, 1 to 10,000 | `nav_oracle.constructor_args` |
| **`nav_oracle`** | `config.max_down_bps` | `u32` (basis points) | Largest downward move per attestation, 1 to 10,000; 10,000 lets a loss of any size land at once | `nav_oracle.constructor_args` |
| **`nav_oracle`** | `config.min_answer` | `i128` (18 decimals) | Absolute floor price per share (cannot be zero or negative) | `nav_oracle.constructor_args` |
| **`nav_oracle`** | `config.max_answer` | `i128` (18 decimals) | Absolute ceiling price per share ($\ge \text{min\_answer}$, $\le 10^{6} \times 10^{18}$, `MAX_ANSWER`) | `nav_oracle.constructor_args` |
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
| **Standing Notice** | `set_notice(secs: u64)`; after setup, lowering goes through `propose_change(Notice(secs))` → `apply_change(id)` | Governance | Notice wait before pricing. Default: `0`. Must satisfy $\text{secs} \le \text{upgrade\_delay}$ and $\text{secs} \le 30 \text{ days}$ (`MAX_NOTICE_SECS`), checked again when a `Notice` change applies. Raising is instant. |
| **Custodian Address** | `set_custodian(custodian: Address)` during setup; afterwards `propose_change(Custodian(address))` → `apply_change(id)` | Governance | Recipient address for off-chain capital deployment. Required before `finish_setup` and `deploy_to_custodian`. Never the vault itself (`InvalidCustodian`), checked when it is set, proposed and applied. The deploy sets it before setup closes. |
| **Deposit Cap** | `set_deposit_cap(cap: Option<i128>)` | Governance | Maximum capacity for deposited capital. `None` = unbounded. Refuses negative cap. Instant both ways, also after setup. |
| **Wind-Down Delay** | `set_wind_down_delay(secs: u64)`; after setup, lowering goes through `propose_change(WindDownDelay(secs))` → `apply_change(id)` | Governance | Minimum notice before wind-down activation. Default and minimum 7 days (`MIN_WIND_DOWN_DELAY`), maximum 90 days (`MAX_WIND_DOWN_DELAY`). Raising is instant. |
| **Upgrade Delay** | `propose_change(UpgradeDelay(secs))` → `apply_change(id)` | Governance | Timelock delay for wasm upgrades. Must be $\ge 7 \text{ days}$, $\le 90 \text{ days}$, and $\ge \text{notice}$. |
| **Oracle Configuration** | `set_config(config: OracleConfig)`; after setup, `propose_change(Config(config))` → `apply_change(id)` | Governance | Updates oracle parameters within the constructor's bounds. `set_config` is instant during the oracle's setup. After it, `set_config` is instant only for a shorter `freshness_duration`: later reports go stale sooner, and no value moves. Every other change, tighter limits included, goes through `propose_change(Config(config))` → `apply_change(id)`, and the bounds are checked again when it applies. A tighter fall cap or a longer cooldown can hold the price above a real loss, and a narrower band can stop pricing. Applying a `Config` change sets every field, freshness included; to keep a cut made after the proposal, cancel the queued change and propose again. |
| **Oracle Feed** | `propose_change(Oracle(address))` → `apply_change(id)` | Governance | Waits for the timelock. The new feed must name this vault through `vault()` with its own setup finished, and must answer `state()` and `freshness_duration()`, at proposal and again at apply (`FeedNotBound`). The next fulfilment prices from it, including an epoch sealed before the swap. |

### Health View

`health()` returns one flag per check. A deployment is ready when `setup_open` is false and every other flag is true. `health()` leaves out two `finish_setup` checks: that the share token has no shares outstanding, which stops being true once the vault has holders, and that no admin hand-over offered during setup is pending (`AdminTransferPending`). If `finish_setup` refuses with `SetupIncomplete` while every field from `token_bound` to `feed_answers` is true, shares were minted before setup; the token's `total_supply()` shows them.

| Field | True when |
|---|---|
| `setup_open` | `finish_setup` has not run yet. While true, admin changes are instant and deposits are refused. |
| `token_bound` | The share token names this vault through `vault()` and its own setup is finished. |
| `oracle_bound` | The oracle names this vault through `vault()` and its own setup is finished. |
| `sole_token_manager` | This vault is the share token's only `manager`. |
| `allowlisted` | This vault passes the share token's identity verifier. Escrowing and returning shares do not need it. Only a delisted holder's conversion does: it mints the shares into the vault's own escrow. While this flag is false, those conversions wait until the vault is allowlisted again, and nothing is lost. |
| `vault_unfrozen` | The share token has not frozen this vault's address. The vault's own share moves ignore an address freeze, so freezing the vault stops nothing; `finish_setup` still refuses a frozen vault. |
| `compliance_bound` | The share token is in its compliance contract's `linked_tokens`, and a compliance contract that answers `vault()` and `setup_open()` names this vault with its own setup finished. One that does not answer them is an external module and passes; its own governance is a trust assumption. |
| `decimals_match` | The asset's `decimals()` equals the share token's. Pricing converts base units at the attested price, so a mismatch would put every deposit and exit off by a power of ten. |
| `addresses_distinct` | The asset, the share token, the oracle and the vault are four different addresses. |
| `custodian_set` | A custodian is set, and it is not the vault itself. |
| `feed_answers` | The oracle answers `state()` and `freshness_duration()`. A new feed with no report passes. `oracle_bound` cannot tell a feed from another contract bound to this vault, such as the compliance contract. |
| `feed_valid` | The oracle reports `Valid`: a report exists, it has not expired and the NAV is not paused. |
| `freshness_covers_notice` | The oracle's `freshness_duration` is at least the vault's notice. |

`freshness_covers_notice` false means a report can expire before the notice ends. A sealed epoch's cancellation window can then reopen on its own, so set `freshness_duration` above the notice. `feed_valid` false right after a deploy is normal until the first attestation.

---

## 3. Role & Authority Matrix

Strata distributes control across five native Stellar multisig authorities and permissionless public entrypoints. Every privileged function is mapped to exactly one authority, except the share token's `legal_transfer` and `recover_balance`, which need compliance and governance in the same call. Each call asks each account it needs for one signature. An admin entrypoint the kit defines takes no caller argument: the stored admin signs it.

### Authority Capabilities & Anti-Capabilities

| Authority | Quorum / Profile | Authorized Capabilities | Anti-Capabilities (What It Cannot Do) |
|---|---|---|---|
| **Governance** | High-quorum deliberative multisig | Set parameters (`notice`, `custodian`, `deposit_cap`, `wind_down_delay`), propose/apply upgrades, propose/cancel wind-down, unpause the vault, pause/unpause the share token, transfer admin, finish each contract's one-time setup, co-sign compliance's `legal_transfer` and `recover_balance` as the share token's admin. After setup, these wait for the timelock: role grants, revoking the manager, admin hand-over, the custodian, lowering the notice or the wind-down delay, upgrades, the token's compliance and verifier swaps, the compliance contract's module and token-binding changes, and oracle config changes other than a shorter freshness window. Revoking the treasury or the guardian stays instant, because taking a power away moves no value. | **Cannot pause the vault directly**; cannot move funds; cannot initiate custodian transfers; cannot attest prices; cannot bypass timelocks. |
| **Guardian** | Low-threshold fast-reaction multisig | `pause` (vault); `pause_nav` (oracle emergency price freeze). | **Cannot unpause**; cannot move funds; cannot block redemption requests; cannot block payable claims or cancellations. |
| **Treasury** | Operational capital multisig | `deploy_to_custodian` (moves free reserve); `fund` (returns assets from custodian). | **Cannot deploy while anything is uncovered**; cannot touch escrowed subscription assets; cannot alter parameters or pause. |
| **Attester** | High-security attestation multisig | `attest` (submits NAV report with proof reference). | **Cannot price outside deviation band**; cannot violate cooldown; cannot operate on the vault directly. |
| **Compliance** | Legal / KYC operator multisig | Manage allowlist (`allow`), topic claims; token interventions (`freeze`; `legal_transfer` and `recovery` co-signed by governance). | **Cannot touch vault reserve**; cannot move a holder's shares without governance's signature in the same call; cannot move shares out of or into the vault's address, or freeze it once the token knows its vault (an earlier freeze makes the vault's `finish_setup` refuse); cannot pause vault operations; cannot bypass exit-only cash redemptions for an unfrozen holder — freezing holds a covered claim until it lifts, rather than paying or redirecting it. |
| **Manager** | Operational keeper account / vault | `close_epoch` (vault); `mint`, `burn`, `forced_transfer` (share token). | **Cannot choose prices**; cannot prevent epoch fulfillment; cannot alter timelocks. |
| **Permissionless** | Any caller / keeper / investor | `fulfill_epoch`, `request_deposit`, `cancel_deposit`, `claim_deposit`, `request_redeem`, `cancel_redeem`, `claim_redeem`, `activate_wind_down`, `finalize_wind_down_round`, `claim_wind_down`. | Operations are strictly constrained by contract state, timing, and solvency guards. |

---

### Comprehensive Entrypoint Permission Matrix

| Contract | Entrypoint | Calling Authority | Access Control Guard | Pausable? |
|---|---|---|---|---|
| **`AsyncVault`** | `request_deposit` | Investor (Caller) | `holder.require_auth()`; refused until setup finishes (`SetupOpen`) | Yes (halted by pause) |
| **`AsyncVault`** | `cancel_deposit` | Investor (Caller) | `holder.require_auth()` | No (open during pause) |
| **`AsyncVault`** | `claim_deposit` | Investor (Caller) | `holder.require_auth()` | No (open during pause) |
| **`AsyncVault`** | `request_redeem` | Investor (Caller) | `holder.require_auth()` | No (always open) |
| **`AsyncVault`** | `cancel_redeem` | Investor (Caller) | `holder.require_auth()` | No (open during pause) |
| **`AsyncVault`** | `claim_redeem` | Investor (Caller) | `holder.require_auth()` | No (always open) |
| **`AsyncVault`** | `close_epoch` | Manager | `#[only_role(caller, "manager")]` | No |
| **`AsyncVault`** | `fulfill_epoch` | Permissionless | None | Yes (halted by pause) |
| **`AsyncVault`** | `pause` | Guardian | `#[only_role(caller, "guardian")]` | N/A |
| **`AsyncVault`** | `unpause` | Governance | `caller` must be the admin (`AdminRequired`), then `caller.require_auth()` | N/A |
| **`AsyncVault`** | `set_notice` | Governance | `#[only_admin]`; raising is instant, lowering is instant during setup, then `propose_change` | No |
| **`AsyncVault`** | `set_custodian` | Governance | `#[only_admin]`; instant during setup, then `propose_change`; never the vault itself (`InvalidCustodian`) | No |
| **`AsyncVault`** | `set_deposit_cap` | Governance | `#[only_admin]`; instant both ways | No |
| **`AsyncVault`** | `set_wind_down_delay` | Governance | `#[only_admin]`; raising is instant, lowering is instant during setup, then `propose_change`; never below 7 days | No |
| **`AsyncVault`** | `finish_setup` | Governance | `#[only_admin]`; needs the wiring complete and no pending admin hand-over; once | No |
| **`AsyncVault`** | `setup_open` | Permissionless | None (view) | No |
| **`AsyncVault`** | `propose_wind_down` | Governance | `#[only_admin]` | No |
| **`AsyncVault`** | `cancel_wind_down_proposal` | Governance | `#[only_admin]` | No |
| **`AsyncVault`** | `activate_wind_down` | Permissionless | None (requires timelock elapsed) | No |
| **`AsyncVault`** | `finalize_wind_down_round` | Permissionless | None | No |
| **`AsyncVault`** | `claim_wind_down` | Shareholder (Caller) | `holder.require_auth()` | No |
| **`AsyncVault`** | `deploy_to_custodian` | Treasury | `#[only_role(caller, "treasury")]` | No (open during pause) |
| **`AsyncVault`** | `fund` | Treasury | None (caller transfers funds) | No |
| **`AsyncVault`** | `propose_change` | Governance | `#[only_admin]`; after setup | No |
| **`AsyncVault`** | `cancel_change` | Governance | `#[only_admin]` | No |
| **`AsyncVault`** | `apply_change` | Governance | `#[only_admin]` | Refused if paused or winding down |
| **`AsyncVault`** | `pending_changes` | Permissionless | None (view) | No |
| **`AsyncVault`** | `grant_role`, `transfer_admin_role` | Governance | Instant during setup, then `propose_change` (a zero `live_until_ledger` cancels at once) | No |
| **`AsyncVault`** | `revoke_role` | Governance | `treasury`, `guardian`: instant. `manager`: instant during setup, then `propose_change` | No |
| **`AsyncVault`** | `set_role_admin` | None | Always refused (`UseTimelock`) | N/A |
| **`AsyncVault`** | `accept_admin_transfer` | Proposed Admin | The pending admin's `require_auth()` | No |
| **`NavOracle`** | `attest` | Attester | `#[only_role(caller, "attester")]` | Refused if the NAV is paused |
| **`NavOracle`** | `pause_nav` | Guardian | `#[only_role(caller, "guardian")]` | N/A |
| **`NavOracle`** | `set_nav_paused` | Governance | `#[only_admin]` | N/A |
| **`NavOracle`** | `set_config` | Governance | `#[only_admin]`; instant during setup, then only for a shorter `freshness_duration`; otherwise `propose_change` | No |
| **`NavOracle`** | `clear_latest` | Governance | `#[only_admin]` (requires NAV paused) | No |
| **`NavOracle`** | `bind_vault` | Governance (oracle admin) | `#[only_admin]`; during setup, once | No |
| **`NavOracle`** | `finish_setup` | Governance | `#[only_admin]`; needs a bound vault and no pending admin hand-over | No |
| **`NavOracle`** | `propose_change` | Governance | `#[only_admin]`; after setup | No |
| **`NavOracle`** | `cancel_change` | Governance | `#[only_admin]` | No |
| **`NavOracle`** | `apply_change` | Governance | `#[only_admin]`; after the vault's delay | Refused while the vault is paused or winding down |
| **`NavOracle`** | `pending_changes` | Permissionless | None (view) | No |
| **`NavOracle`** | `grant_role`, `transfer_admin_role` | Governance | Instant during setup, then `propose_change` (a zero `live_until_ledger` cancels at once) | No |
| **`NavOracle`** | `revoke_role` | Governance | Instant (`attester`, `guardian`) | No |
| **`NavOracle`** | `set_role_admin` | None | Always refused (`UseTimelock`) | N/A |
| **`ShareToken`** | `pause` | Admin (Governance) | `caller` must be the admin (`AdminRequired`), then `caller.require_auth()` | N/A |
| **`ShareToken`** | `unpause` | Admin (Governance) | `caller` must be the admin (`AdminRequired`), then `caller.require_auth()` | N/A |
| **`ShareToken`** | `mint` | Manager (Vault) | `#[only_role(operator, "manager")]` | Bypasses token pause |
| **`ShareToken`** | `burn` | Manager (Vault) | `#[only_role(operator, "manager")]` | Bypasses token pause |
| **`ShareToken`** | `forced_transfer` | Manager (Vault) | `#[only_role(operator, "manager")]` | Bypasses token pause |
| **`ShareToken`** | `legal_transfer` | Compliance, co-signed by Governance (token admin) | `#[only_role(caller, "compliance")]` and the admin's `require_auth()` in the same call, from two different accounts; never from or to the vault's address; the destination passes `verify_identity`; a reference of 1–128 bytes | Bypasses token pause |
| **`ShareToken`** | `set_address_frozen`, `freeze_partial_tokens`, `unfreeze_partial_tokens` | Compliance | `#[only_role(operator, "compliance")]`; never freezes the vault's address once the token knows its vault | No |
| **`ShareToken`** | `recover_balance` | Compliance, co-signed by Governance (token admin) | `#[only_role(operator, "compliance")]` and the admin's `require_auth()` in the same call, from two different accounts; never from or to the vault's address | No |
| **`ShareToken`** | `set_compliance`, `set_identity_verifier` | Governance | `operator` must be the admin (`AdminRequired`), then `operator.require_auth()`; instant during setup, then `propose_change` | No |
| **`ShareToken`** | `bind_vault` | Governance (token admin) | `#[only_admin]`; during setup, once | No |
| **`ShareToken`** | `finish_setup` | Governance | `#[only_admin]`; needs a bound vault and no pending admin hand-over | No |
| **`ShareToken`** | `propose_change` | Governance | `#[only_admin]`; after setup | No |
| **`ShareToken`** | `cancel_change` | Governance | `#[only_admin]` | No |
| **`ShareToken`** | `apply_change` | Governance | `#[only_admin]`; after the vault's delay | Refused while the vault is paused or winding down |
| **`ShareToken`** | `pending_changes` | Permissionless | None (view) | No |
| **`ShareToken`** | `grant_role`, `transfer_admin_role` | Governance | Instant during setup, then `propose_change` (a zero `live_until_ledger` cancels at once) | No |
| **`ShareToken`** | `revoke_role` | Governance | `compliance`: instant. `manager`: instant during setup, then `propose_change` | No |
| **`ShareToken`** | `set_role_admin` | None | Always refused (`UseTimelock`) | N/A |
| **`IdentityVerifier`** | `allow` | Admin (Compliance) | `#[only_admin]` | No |
| **`IdentityVerifier`** | `set_claim_topics_and_issuers`| Admin (Compliance) | `#[only_admin]`; `operator` is not read | No |
| **`Compliance`** | `bind_token`, `unbind_token`, `add_module_to`, `remove_module_from` | Governance | `#[only_admin]`, `operator` is not read; instant during setup, then `propose_change` | No |
| **`Compliance`** | `bind_vault` | Governance (compliance admin) | `#[only_admin]`; during setup, once | No |
| **`Compliance`** | `finish_setup` | Governance | `#[only_admin]`; needs a bound vault and no pending admin hand-over | No |
| **`Compliance`** | `propose_change` | Governance | `#[only_admin]`; after setup | No |
| **`Compliance`** | `cancel_change` | Governance | `#[only_admin]` | No |
| **`Compliance`** | `apply_change` | Governance | `#[only_admin]`; after the vault's delay | Refused while the vault is paused or winding down |
| **`Compliance`** | `pending_changes` | Permissionless | None (view) | No |
| **`Compliance`** | `transfer_admin_role` | Governance | Instant during setup, then `propose_change` (a zero `live_until_ledger` cancels at once) | No |
| **`Compliance`** | `accept_admin_transfer` | Proposed Admin | The pending admin's `require_auth()` | No |

---

## 4. Deployment Runbook Summary

A clean deployment executes in three sequenced phases:

1. **Phase 1: Contract Deployment**
   - Deploy `compliance`, `identity_verifier`, `share_token`, `nav_oracle`, and `async_vault` with constructor arguments matching `environments.toml`.
2. **Phase 2: Post-Deployment Role Wiring**
   - Call `ShareToken::grant_role(vault_address, "manager", governance)` to authorize lazy share minting and burning.
   - Call `ShareToken::bind_vault(vault_address)`, then `ShareToken::finish_setup()`. The token's admin changes are instant until then and wait for the vault's timelock afterwards.
   - Call `IdentityVerifier::allow(vault_address, true)`, signed by the compliance key, so a delisted holder's priced deposit can be minted into the vault's escrow; `finish_setup` requires it.
   - Call `Compliance::bind_token(share_token_address, governance)` to link SEP-57 rule verification, then `Compliance::bind_vault(vault_address)` and `Compliance::finish_setup()`. Its module and binding changes are instant until then and wait for the vault's timelock afterwards.
   - Call `NavOracle::bind_vault(vault_address)`, then `NavOracle::finish_setup()`. The oracle's admin changes are instant until then and wait for the vault's timelock afterwards.
   - On the vault, call `set_custodian(custodian)`, `set_notice(secs)` and, if initial capital intake is bounded, `set_deposit_cap(cap)`. All three are instant during setup, so deposits never open without the cap. The custodian is required, and the vault's own address is refused (`InvalidCustodian`).
   - Then call `finish_setup()` on the vault. It refuses with `SetupIncomplete` until every wiring step above is in place, the token has no shares outstanding and the vault's address is not frozen on it. It also needs the asset to have the token's decimals, four different addresses for the asset, the token, the oracle and the vault, and an oracle that answers `state()` and `freshness_duration()`. It refuses with `AdminTransferPending` while an admin hand-over offered during setup is pending. `health()` shows which check is false. The vault takes no deposit before it.
3. **Phase 3: Operational Parameterization**
   - Oracle reporter submits the genesis NAV attestation (`attest`).

---

## 5. Storage Lifetime (TTL) Policy

Soroban archives a ledger entry when its time to live (TTL) runs out. An
archived entry cannot be read until it is restored, so a contract whose
instance is archived refuses every call.

The kit runs the same code on every network. Each persistent entry, the
contract instance included, has a target lifetime and a threshold one day
shorter. Writing an entry does not extend it on its own: an entry goes back to
its target only when a call asks for that and its TTL has fallen to the
threshold. The kit's storage helpers ask on every read and every write of the
kit's own entries. OpenZeppelin asks when it reads an entry that already
exists, never when it writes one, so the kit reads back each entry it creates
through OpenZeppelin. The transaction that creates an entry therefore extends
it to its target at once; the compliance stub's modules and bound tokens are
the one exception (see **What OpenZeppelin extends**). The network decides only
how long a new entry lives before any extension (see **Network settings**).

| Contract | What it extends | When | To how long |
|---|---|---|---|
| `async_vault` | Its instance, and every persistent entry it reads or writes: epochs, requests, settlements, wind-down positions, pending governance changes | Every call that reads or writes the entry | 30 days (518,400 ledgers), once 29 days or less remain |
| `nav_oracle` | Its instance, the latest report, and each pending governance change it reads or writes | `attest` extends the instance and the report; `bind_vault`, `finish_setup`, `grant_role`, `transfer_admin_role`, `propose_change`, `cancel_change` and `apply_change` extend the instance; every other call extends whichever entry it reads or writes | Same |
| `share_token` | Its instance, each balance and freeze entry it writes, and each pending governance change it reads or writes | Every call that moves shares or changes token settings: `transfer`, `transfer_from`, `approve`, `mint`, `burn`, `forced_transfer`, `legal_transfer`, freezes, recovery, `set_compliance`, `set_identity_verifier`, `pause`, `unpause`, `grant_role`, `revoke_role`, `transfer_admin_role`, `bind_vault`, `finish_setup`, `propose_change`, `cancel_change`, `apply_change`; also the reads `balance` and `total_supply`, which may be the only token calls during a wind-down | Same |
| `identity_verifier` | Its instance and each allowlist entry | `allow`, `is_allowed`, `verify_identity` | Same |
| `compliance` | Its instance, and each pending governance change it reads or writes | Every hook the token calls (`can_create`, `can_transfer`, `created`, `transferred`, `destroyed`) and its admin calls | Same |
| `async_vault`, `share_token`, `nav_oracle` | The four entries a grant writes: the account's role, its member-list slot, the member count and the role list | Each grant (in the constructor, `grant_role` and an applied `GrantRole` change) extends all four. After that, a role check extends only that account's role entry; the slot, the count and the list are extended only by grants and by calls that list role members (such as the vault's `manager()` or the token's `get_role_member_count`) | 90 days (1,555,200 ledgers), once 89 days or less remain |

The kit's own lengths are the constants in `crates/strata-storage`
(`PERSISTENT_EXTEND_AMOUNT`, `INSTANCE_EXTEND_AMOUNT`, and thresholds one day
shorter). The entries OpenZeppelin stores keep OpenZeppelin's own lengths. All
of them are fixed in code: a governance setting would add an admin power for
little gain.

**Pending governance changes.** A change waiting in the timelock of
`async_vault`, `share_token`, `nav_oracle` or `compliance` lives as a persistent entry,
extended to 30 days when it is proposed. The wait itself can run up to 90 days
(`strata_timelock::MAX_DELAY`), so a change nobody touches can archive before it is
due. Nothing is lost: the call that applies it restores the archived entry
itself and pays the restore fee, the same as any other archived entry.
`npm run extend` also keeps it alive: it reads each contract's open ids from
its `pending_changes()` view, builds each one's storage key the way the
timelock crate does, and extends it the same 30 days as every instance and
Wasm.

**What OpenZeppelin extends, and what the kit adds.** `stellar-tokens` 0.7.2
stores the share token's balances and freeze entries, and the compliance
contract's modules and bound tokens. `stellar-access` 0.7.2 stores the roles of
the vault, the token and the oracle. OpenZeppelin extends an existing entry
when it reads it: balances, freezes, modules and bound tokens to 30 days, roles
to 90. It does not extend an entry when it writes one, so a new entry would
start at the network's minimum lifetime and wait for a later caller to read it.
The kit closes that gap by reading back what it writes, through OpenZeppelin's
own reads, in the same call:

- the share token reads back each balance and freeze entry after `mint`,
  `burn`, `transfer`, `transfer_from`, `forced_transfer`, `legal_transfer`,
  `recover_balance`, `set_address_frozen`, `freeze_partial_tokens` and
  `unfreeze_partial_tokens`;
- the vault, the token and the oracle read back every entry a grant writes (the
  account's role, its place in the member list, the member count and the list
  of roles) after each grant in their constructors, in `grant_role`, and in an
  applied `GrantRole` change.

So a new balance, freeze or role entry reaches its target in the transaction
that creates it, and the kit keeps OpenZeppelin's thresholds without copying
them. A revoke creates nothing: it rewrites the member count and moves the last
member into the freed slot with plain writes, and extends none of the entries
it moves. The compliance stub does not read back its modules and bound tokens
when it writes them. The vault's `finish_setup` reads the bound tokens, which
extends them, and every hook the token calls reads its modules; the hooks after
a mint, transfer or burn read the bound tokens too. Allowances are temporary
entries that live until their `live_until_ledger`. OpenZeppelin never extends
an instance; the kit does, as above. The token's total supply and metadata live
in its instance.

**Network settings.** Each network sets how long a new persistent entry lives
and how far one extension can reach. Validators can change these settings by
vote; the kit hardcodes neither. Check
[Stellar Lab's network limits](https://lab.stellar.org/network-limits) for
current values.

| Setting | Testnet | Mainnet |
|---|---|---|
| Minimum lifetime of a new persistent entry | 120,960 ledgers (about 7 days) | 2,073,600 ledgers (about 120 days) |
| Longest lifetime one extension can reach | 3,110,400 ledgers (about 180 days) | 3,110,400 ledgers (about 180 days) |

Read over RPC on 2026-10-20.

**What this means on each network.** On testnet a new entry would live about 7
days, less than any threshold, so renewals start in its first week: the
transaction that creates it extends it to its target, and from the next day any
call that reads it renews it. On mainnet a new entry already lives 120
days, more than any target, so the extension in the creating transaction
changes nothing. No call renews a 30-day entry there until about the fourth
month (day 91), or a role until day 31. A restored entry comes back with the
network's minimum lifetime, so a mainnet restore pays at least 120 days of
rent.

**Why the same values on every network.** The protocol already applies each
network's minimum, so mainnet entries start at 120 days without the kit knowing
it. The same Wasm runs on testnet and on mainnet, so what is tested on testnet
is what ships; a build-time network profile would mean two Wasm files to
review. The threshold one day under the target means an entry in daily use is
renewed at most once a day, for about a day of rent. Capping each extension
(`extend_ttl_with_limits`) would let rarely used entries archive sooner, and
each of those restores would pay at least 120 days of rent on mainnet.

**Who pays.** The account that sends a transaction pays the rent for every
extension that transaction triggers. The transaction that creates an entry pays
for its target, or for the network's minimum when that is longer: 30 or 90 days
on testnet, 120 days on mainnet. A later call pays only to bring an entry back
to its target once it has fallen to its threshold: about a day of rent when
the entry is read daily, up to a whole target after a long quiet period. A
restore pays for the network's minimum, as above.

**What frontends should do.**

- Expect uneven renewal fees. The first call after a quiet period pays to renew
  every entry it reads that has fallen to its threshold, so the same call can
  cost more after a quiet week than on a busy day.
- Simulate again just before submitting. The fee comes from the simulation. If
  an entry falls to its threshold between simulation and submission, the call
  pays a renewal the fee does not cover, and the transaction fails.
- Let RPC add a restore when simulation asks for one. When a call needs an
  archived entry, simulation adds its restore to the transaction (see
  **Restoring**). Submit the transaction as simulated, restore included.

**Idle deployments.** An entry nobody reads archives when its lifetime runs
out: 30 days after its last renewal (90 for a role), and on mainnet never
sooner than 120 days after it was created. Run
`STELLAR_ACCOUNT=<funded account> npm run extend -w scripts/harness` after
every deploy and before a long quiet period. It restores, when archived, and
extends by 30 days three kinds of entry only: each contract instance, the Wasm
it runs, and each pending timelock change. Other entries, such as balances and
roles, are restored by the call that needs them (see **Restoring**). It reads
the contracts in `environments.toml [staging.contracts]`; `--env <name>` picks
another environment, and `--config <record>` reads a deployment record instead.
Extending needs no authority, so any funded account can pay.

**Restoring.** Since Protocol 23 an invocation can restore archived entries
itself, so a call to an archived contract usually goes through once simulation
adds the restore. Restoring many entries in one transaction can still hit
per-transaction limits. Restore them first, in batches: each
`RestoreFootprintOp` transaction takes as many entries as the limits allow.
`stellar contract restore` sends one: `--id <contract>` restores an instance,
`--id <contract> --key-xdr <key>` a data entry, and `--wasm-hash <hash>` a
Wasm. After a restore, simulate the call again before sending it.

**Production modules.** The compliance and identity contracts in this
repository are testnet stubs. A production compliance module or identity
registry must extend its own instance and entries the same way, each entry in
the transaction that creates it, or the share token stops working when they
archive.

---

## 6. Contract Interfaces for Adopters

The vault reaches the other contracts only through these traits. An adopter
who replaces one implements the trait, and the compiler checks the
implementation against what the vault calls.

| Interface | Defined in | Implemented here by | What the vault calls |
|---|---|---|---|
| `OracleFeed` | `crates/strata-bindings` | `nav-oracle` | `state`, `nav_per_share`, `attested_at`, `freshness_duration` |
| `FungibleToken` | OpenZeppelin `stellar-tokens` 0.7.2 | `share-token` | `transfer`, `balance`, `total_supply`, `decimals` |
| `RWAToken` | OpenZeppelin `stellar-tokens` 0.7.2 | `share-token` | `mint`, `burn`, `forced_transfer` |
| `IdentityVerifier` | OpenZeppelin `stellar-tokens` 0.7.2 | `identity-verifier` (testnet stub) | `verify_identity`, called by the share token |

A feed that implements `OracleFeed` can replace `nav-oracle`; it must report
`Stale` once its report outlives `freshness_duration`, and `attested_at` must
be the ledger time the report was accepted, not a time the reporter supplies.

Two more traits connect the share token, the oracle and the kit's compliance
contract to the vault's timelock. The vault implements `ClockSource`
(`crates/strata-timelock`), and the three read its `timelock_clock` to time their own
changes. Each implements `VaultBinding` (`crates/strata-bindings`): `vault` names the
vault it is bound to, and `setup_open` says whether its admin changes are still
instant.

The vault's `finish_setup` reads the token and the oracle through
`VaultBinding` and refuses until each reports this vault with its own setup
closed. It reads the compliance contract the same way, but accepts one that
does not answer `VaultBinding`: such an external module keeps its own
governance, which is a trust assumption. It also reads the token's
`manager` members (OpenZeppelin `AccessControl`), its `total_supply` and
`decimals` (`FungibleToken`) and the asset's `decimals`, runs
`verify_identity` on its own address, reads `linked_tokens` from the token's
compliance contract (OpenZeppelin `TokenBinder`), and calls the oracle's
`state` and `freshness_duration` (`OracleFeed`). A replacement for any of these
must answer those calls, or the vault's setup cannot finish.
