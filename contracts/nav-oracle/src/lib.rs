//! # Design
//!
//! The feed the vault prices epochs from. An attester reports the share price,
//! and the oracle keeps the latest report that passes the limits the admin
//! sets.
//!
//! - **The ledger dates a report.** It expires at the earlier of `expires_at`
//!   and its acceptance plus `freshness_duration`. The cost: the vault compares
//!   acceptance times, not valuation dates.
//! - **The proof is anchored, never verified.** A report carries a hash of its
//!   evidence and may say where to read it. The cost: any hash that is not all
//!   zeros passes, so a reader fetches the evidence and compares the hash.
//! - **No report while the NAV is paused.** The guardian or the admin pauses
//!   it; only the admin lifts it. The cost: the vault prices nothing meanwhile,
//!   and sealed epochs reopen to cancellation.
//! - **Tightening waits too.** After setup only a shorter `freshness_duration`
//!   is instant: a tighter cap or band moves value too. The cost: an urgent
//!   limit change waits the full delay.
//! - **The band applies on read.** A stored report outside the band reads as
//!   stale. The cost: narrowing the band away from it stops pricing, and new
//!   reports far from it fail the cap until `clear_latest`.
//! - **Both moves are capped.** Both caps are required; a 10,000 bps fall cap
//!   lets any loss land at once. The cost of a lower one: a loss takes several
//!   reports, and exits priced meanwhile are paid above value.
//! - **Revoking is instant, granting waits.** After setup a new attester or
//!   guardian waits for the timelock. The cost: replacing a compromised
//!   attester keeps the NAV paused for the whole delay.
//! - **Clearing needs a paused NAV.** `clear_latest` runs only while the NAV is
//!   paused, so the next report is a separate act. The cost: that report has no
//!   earlier price to cap it; only the band bounds it.
//! - **One report per cooldown.** The cooldown runs from one second to
//!   `freshness_duration`, so no two reports share a ledger. The cost: an epoch
//!   sealed just after a report waits up to a cooldown for the next.

#![no_std]

mod extend;
mod governance;
mod guards;
mod state;

use soroban_sdk::{
    contract, contracterror, contractevent, contractimpl, panic_with_error, Address, BytesN, Env,
    String, Symbol, Vec,
};
use stellar_access::access_control::{self, AccessControl};
use stellar_contract_utils::upgradeable;
use stellar_macros::{only_admin, only_role};
use strata_bindings::{OracleFeed, VaultBinding};

use state::{get_config, get_latest, nav_paused, ATTESTER_ROLE, GUARDIAN_ROLE};

pub use governance::{
    shortens_freshness_only, OracleChange, OraclePendingChange, ADMIN_ACCEPT_LEDGERS,
};
pub use state::{NavInput, NavReport, OracleConfig, OracleState};

const BPS_DENOM: i128 = 10_000;
const WAD: i128 = 1_000_000_000_000_000_000;

/// One report per ledger at most. A deployment sets a longer cooldown.
pub const MIN_COOLDOWN_SECS: u64 = 1;
/// Thirty-five days: a monthly valuation with slack, and no longer.
pub const MAX_FRESHNESS_SECS: u64 = 35 * strata_timelock::DAY_DURATION;
/// A million units of the asset per share. Far above any real price, and far
/// below where the deviation arithmetic could overflow.
pub const MAX_ANSWER: i128 = 1_000_000 * WAD;
/// A millionth of an asset unit per share, mirroring `MAX_ANSWER`. At it, one
/// asset base unit mints at most a million share base units, and a 1 bps
/// move cap still allows a move.
pub const MIN_ANSWER: i128 = WAD / 1_000_000;
/// Longest proof URI an attestation may carry, in bytes.
pub const MAX_PROOF_URI_LEN: u32 = 256;

strata_bindings::error_enum! {
    strata_bindings::ORACLE_ERRORS,

    /// Oracle failures, coded 3000 to 3999. Codes are stable once assigned and
    /// are never reused; a removed variant leaves its number retired.
    #[contracterror]
    #[derive(Copy, Clone, Debug, Eq, PartialEq)]
    #[repr(u32)]
    pub enum OracleError {
        /// A config breaks a bound: `freshness_duration` from 1 s to 35 days,
        /// `cooldown_secs` from 1 s to `freshness_duration`, `min_answer` from
        /// `MIN_ANSWER` to `max_answer`, `max_answer` at most `MAX_ANSWER`,
        /// and each move cap from 1 to 10,000 bps.
        InvalidConfig = 3001,
        /// `nav_per_share <= 0`, or outside `[min_answer, max_answer]`.
        NavOutOfBand = 3002,
        /// Attested before `cooldown_secs` elapsed since the last record.
        CooldownActive = 3003,
        /// The move from the last record exceeds `max_up_bps` (a rise) or
        /// `max_down_bps` (a fall).
        DeviationExceeded = 3004,
        /// `expires_at` not in the future — the record would be born stale.
        ExpiresInPast = 3005,
        /// No report is stored: none has been accepted yet, or `clear_latest`
        /// removed it. `latest`, `nav_per_share` and `attested_at` fail with it.
        NoRecord = 3006,
        /// `ensure_consumable` found the feed in a state other than `Valid`.
        NotConsumable = 3007,
        /// `clear_latest` was called while the NAV was not paused.
        NavNotPaused = 3008,
        /// `renounce_admin` is always refused: the oracle must always have an
        /// admin. Hand it over instead: propose and apply an `Admin` change
        /// (`transfer_admin_role` during setup), then the nominee calls
        /// `accept_admin_transfer`.
        AdminRequired = 3009,
        /// The NAV is paused. Unpause it first; a report never lifts it.
        NavPaused = 3010,
        /// No pending change has this id.
        ChangeNotFound = 3011,
        /// The change's delay has not elapsed.
        ChangeNotReady = 3012,
        /// As many changes as the timelock holds already wait.
        TooManyPendingChanges = 3013,
        /// Changes are instant until setup finishes; there is nothing to propose yet.
        SetupOpen = 3014,
        /// A direct call cannot make this change. After setup it goes through
        /// `propose_change`; setting a role admin is never allowed.
        UseTimelock = 3015,
        /// Only possible while setup is open, and only once.
        SetupClosed = 3016,
        /// Setup cannot finish before the oracle is bound to its vault.
        VaultNotBound = 3017,
        /// The vault is winding down, so no change may be proposed or applied,
        /// and no admin hand-over is accepted.
        WindDownActive = 3018,
        /// The vault is paused, which holds every timelocked change.
        VaultPaused = 3019,
        /// The change's delay is shorter than the vault's notice, so an investor
        /// could not complete an exit before it lands.
        DelayBelowNotice = 3020,
        /// An upgrade already waits. Cancel it before proposing another.
        UpgradeAlreadyPending = 3021,
        /// The proof hash is all zeros, so it commits to nothing.
        EmptyProofHash = 3023,
        /// The proof URI is longer than `MAX_PROOF_URI_LEN` bytes.
        ProofUriTooLong = 3024,
        /// An admin hand-over offered during setup is still open. Setup finishes
        /// once it is accepted, cancelled or expired, so no nominee from setup can
        /// accept after changes start to wait.
        AdminTransferPending = 3025,
        /// The configuration the constructor writes is absent from instance
        /// storage.
        NotInitialized = 3026,
    }
}

#[contractevent]
pub struct NavAttested {
    #[topic]
    pub attester: Address,
    pub nav_per_share: i128,
    pub expires_at: u64,
    pub proof_hash: BytesN<32>,
    pub proof_uri: String,
}

#[contractevent]
pub struct LatestCleared {}

#[contractevent]
pub struct NavPausedSet {
    pub paused: bool,
}

#[contractevent]
pub struct ChangeProposed {
    #[topic]
    pub id: u32,
    pub change: OracleChange,
    pub eta: u64,
}

#[contractevent]
pub struct ChangeCancelled {
    #[topic]
    pub id: u32,
}

#[contractevent]
pub struct ChangeApplied {
    #[topic]
    pub id: u32,
    pub change: OracleChange,
}

#[contractevent]
pub struct SetupFinished {}

#[contractevent]
pub struct VaultBound {
    #[topic]
    pub vault: Address,
}

#[contractevent]
pub struct ConfigSet {
    pub freshness_duration: u64,
    pub cooldown_secs: u64,
    pub max_up_bps: u32,
    pub max_down_bps: u32,
    pub min_answer: i128,
    pub max_answer: i128,
}

pub(crate) fn store_config(e: &Env, config: &OracleConfig) {
    state::set_config(e, config);
    ConfigSet {
        freshness_duration: config.freshness_duration,
        cooldown_secs: config.cooldown_secs,
        max_up_bps: config.max_up_bps,
        max_down_bps: config.max_down_bps,
        min_answer: config.min_answer,
        max_answer: config.max_answer,
    }
    .publish(e);
}

fn in_band(cfg: &OracleConfig, nav_per_share: i128) -> bool {
    nav_per_share >= cfg.min_answer && nav_per_share <= cfg.max_answer
}

fn trustworthy(e: &Env, report: &NavReport) -> bool {
    e.ledger().timestamp() <= report.expires_at && in_band(&get_config(e), report.nav_per_share)
}

fn compute_state(e: &Env) -> OracleState {
    if nav_paused(e) {
        return OracleState::Paused;
    }
    match get_latest(e) {
        None => OracleState::Stale,
        Some(r) if trustworthy(e, &r) => OracleState::Valid,
        Some(_) => OracleState::Stale,
    }
}

#[contract]
pub struct NavOracleContract;

#[contractimpl(contracttrait)]
impl AccessControl for NavOracleContract {
    /// Grants `role` to `account` at once. Only during setup; after it, propose
    /// a `GrantRole` change. Revoking stays instant: taking an attester or a
    /// guardian away moves no value.
    ///
    /// # Arguments
    ///
    /// * `account` - The account that gets the role.
    /// * `role` - `attester` or `guardian`.
    /// * `caller` - The admin.
    ///
    /// # Errors
    ///
    /// * `UseTimelock` - Setup has finished.
    /// * `AccessControlError::Unauthorized` - `caller` is not the admin.
    ///
    /// # Events
    ///
    /// * `RoleGranted`, unless `account` already holds `role`.
    ///
    /// # Authorization
    ///
    /// `caller` signs.
    fn grant_role(e: &Env, account: Address, role: Symbol, caller: Address) {
        guards::direct_change_allowed(e);
        strata_storage::bump_instance(e);
        access_control::grant_role(e, &account, &role, &caller);
        extend::role_entries(e, &account, &role);
    }

    /// Offers the admin role to `new_admin`, who takes it with
    /// `accept_admin_transfer`. An offer is instant only during setup; after
    /// it, propose an `Admin` change. Cancelling an offer stays instant.
    ///
    /// # Arguments
    ///
    /// * `new_admin` - The nominee, or the pending nominee when cancelling.
    /// * `live_until_ledger` - The last ledger number the nominee can accept
    ///   in; `0` cancels the pending offer.
    ///
    /// # Errors
    ///
    /// * `UseTimelock` - An offer after setup.
    /// * `RoleTransferError::InvalidLiveUntilLedger` - The ledger has passed or
    ///   is beyond the longest entry lifetime.
    /// * `RoleTransferError::NoPendingTransfer` - Nothing to cancel.
    /// * `RoleTransferError::InvalidPendingAccount` - The cancel names another
    ///   nominee.
    ///
    /// # Events
    ///
    /// * `AdminTransferInitiated`
    ///
    /// # Authorization
    ///
    /// The admin signs.
    fn transfer_admin_role(e: &Env, new_admin: Address, live_until_ledger: u32) {
        guards::direct_hand_over_allowed(e, live_until_ledger);
        strata_storage::bump_instance(e);
        access_control::transfer_admin_role(e, &new_admin, live_until_ledger);
    }

    /// Makes the nominee of a pending hand-over the admin. Refused while the
    /// vault winds down: no admin power changes hands then.
    ///
    /// # Errors
    ///
    /// * `WindDownActive` - The vault is winding down.
    /// * `RoleTransferError::NoPendingTransfer` - No offer is pending.
    /// * `RoleTransferError::TransferExpired` - The offer's last ledger has
    ///   passed.
    ///
    /// # Events
    ///
    /// * `AdminTransferCompleted`
    ///
    /// # Authorization
    ///
    /// The nominee signs.
    fn accept_admin_transfer(e: &Env) {
        guards::vault_not_winding_down(e);
        strata_storage::bump_instance(e);
        access_control::accept_admin_transfer(e);
    }

    /// Refused. A role admin could grant that role with no delay.
    ///
    /// # Arguments
    ///
    /// * `role`, `admin_role` - Not read.
    ///
    /// # Errors
    ///
    /// * `UseTimelock` - Always.
    fn set_role_admin(e: &Env, _role: Symbol, _admin_role: Symbol) {
        panic_with_error!(e, OracleError::UseTimelock);
    }

    /// Refused. An oracle with no admin can never be reconfigured, never clear a
    /// stuck record and never unpause the NAV again. The way out is a hand-over:
    /// propose and apply an `Admin` change (`transfer_admin_role` during setup),
    /// then the nominee calls `accept_admin_transfer`.
    ///
    /// # Errors
    ///
    /// * `AdminRequired` - Always.
    fn renounce_admin(e: &Env) {
        panic_with_error!(e, OracleError::AdminRequired);
    }
}

#[contractimpl(contracttrait)]
impl VaultBinding for NavOracleContract {
    /// The vault whose timelock this oracle's changes wait for, once
    /// `bind_vault` has named it.
    fn vault(e: &Env) -> Option<Address> {
        strata_timelock::setup::source(e)
    }

    /// Whether setup is still open, so admin changes are instant.
    fn setup_open(e: &Env) -> bool {
        strata_timelock::setup::is_open(e)
    }
}

#[contractimpl]
impl NavOracleContract {
    /// Creates the oracle with its admin, its two roles and its limits.
    ///
    /// # Arguments
    ///
    /// * `admin` - Reconfigures the oracle and lifts a NAV pause.
    /// * `attester` - Gets the `attester` role, which submits reports.
    /// * `guardian` - Gets the `guardian` role, which pauses the NAV.
    /// * `config` - The limits reports must meet; see `config`.
    ///
    /// # Errors
    ///
    /// * `InvalidConfig` - `config` breaks a bound.
    ///
    /// # Events
    ///
    /// * `RoleGranted` for `attester` and for `guardian`.
    ///
    /// # Authorization
    ///
    /// None: it runs once, at deployment.
    pub fn __constructor(
        e: &Env,
        admin: Address,
        attester: Address,
        guardian: Address,
        config: OracleConfig,
    ) {
        guards::valid_config(e, &config);
        access_control::set_admin(e, &admin);
        access_control::grant_role_no_auth(e, &attester, &ATTESTER_ROLE, &admin);
        extend::role_entries(e, &attester, &ATTESTER_ROLE);
        access_control::grant_role_no_auth(e, &guardian, &GUARDIAN_ROLE, &admin);
        extend::role_entries(e, &guardian, &GUARDIAN_ROLE);

        state::set_config(e, &config);
        state::set_nav_paused(e, false);
        upgradeable::set_schema_version(e, 1);
    }

    /// The storage layout version, `1` until an upgrade migrates it.
    pub fn schema_version(e: &Env) -> u32 {
        upgradeable::get_schema_version(e)
    }

    /// Names the vault whose timelock this oracle's changes wait for. Once,
    /// and only during setup.
    ///
    /// # Arguments
    ///
    /// * `vault` - The vault. A contract that does not answer
    ///   `timelock_clock` fails the call.
    ///
    /// # Errors
    ///
    /// * `SetupClosed` - Setup has finished, or a vault is already bound.
    ///
    /// # Events
    ///
    /// * `VaultBound`
    ///
    /// # Authorization
    ///
    /// The admin signs.
    #[only_admin]
    pub fn bind_vault(e: &Env, vault: Address) {
        strata_storage::bump_instance(e);
        governance::bind_vault(e, &vault);
    }

    /// Ends the window in which admin changes are instant. It never reopens.
    ///
    /// # Errors
    ///
    /// * `SetupClosed` - Setup has already finished.
    /// * `AdminTransferPending` - An admin hand-over offered during setup is
    ///   still open.
    /// * `VaultNotBound` - No vault is bound.
    ///
    /// # Events
    ///
    /// * `SetupFinished`
    ///
    /// # Authorization
    ///
    /// The admin signs.
    #[only_admin]
    pub fn finish_setup(e: &Env) {
        strata_storage::bump_instance(e);
        governance::finish_setup(e);
    }

    /// Queues a change behind the vault's timelock and returns its id.
    ///
    /// # Arguments
    ///
    /// * `change` - An upgrade, a role grant or revoke, an admin hand-over or
    ///   a new config.
    ///
    /// # Errors
    ///
    /// * `InvalidConfig` - A `Config` change breaks a bound.
    /// * `UpgradeAlreadyPending` - An upgrade already waits.
    /// * `SetupOpen` - Setup has not finished; change it directly.
    /// * `WindDownActive` - The vault is winding down.
    /// * `TooManyPendingChanges` - The queue is full.
    ///
    /// # Events
    ///
    /// * `ChangeProposed`, with its `eta` in seconds.
    ///
    /// # Authorization
    ///
    /// The admin signs.
    #[only_admin]
    pub fn propose_change(e: &Env, change: OracleChange) -> u32 {
        strata_storage::bump_instance(e);
        governance::propose(e, change)
    }

    /// Drops a pending change.
    ///
    /// # Arguments
    ///
    /// * `id` - The id `propose_change` returned.
    ///
    /// # Errors
    ///
    /// * `ChangeNotFound` - No pending change has this id.
    ///
    /// # Events
    ///
    /// * `ChangeCancelled`
    ///
    /// # Authorization
    ///
    /// The admin signs.
    #[only_admin]
    pub fn cancel_change(e: &Env, id: u32) {
        strata_storage::bump_instance(e);
        governance::cancel(e, id);
    }

    /// Lands a change whose delay has run.
    ///
    /// # Arguments
    ///
    /// * `id` - The id `propose_change` returned.
    ///
    /// # Errors
    ///
    /// * `ChangeNotFound` - No pending change has this id.
    /// * `WindDownActive` - The vault is winding down.
    /// * `VaultPaused` - The vault is paused.
    /// * `DelayBelowNotice` - The change's delay is shorter than the vault's
    ///   notice now.
    /// * `ChangeNotReady` - The delay, plus any time the vault spent paused
    ///   since, has not run.
    /// * `InvalidConfig` - A `Config` change breaks a bound.
    /// * `AccessControlError::RoleNotHeld` - A `RevokeRole` names an account
    ///   without the role.
    /// * An `Upgrade` whose Wasm is not on the network fails the call.
    ///
    /// # Events
    ///
    /// * `ChangeApplied`, after the change's own: `ConfigSet`, `RoleGranted`,
    ///   `RoleRevoked` or `AdminTransferInitiated`.
    ///
    /// # Authorization
    ///
    /// The admin signs.
    #[only_admin]
    pub fn apply_change(e: &Env, id: u32) {
        strata_storage::bump_instance(e);
        governance::apply(e, id);
    }

    /// Every change still waiting, with the time in seconds it may land on
    /// the vault's clock as it reads now.
    pub fn pending_changes(e: &Env) -> Vec<OraclePendingChange> {
        governance::pending(e)
    }

    /// The stored report: `nav_per_share` in WAD, `accepted_at` and
    /// `expires_at` in seconds, and the proof the attester gave with it,
    /// `proof_hash` and `proof_uri`.
    ///
    /// # Errors
    ///
    /// * `NoRecord` - No report is stored.
    pub fn latest(e: &Env) -> NavReport {
        get_latest(e).unwrap_or_else(|| panic_with_error!(e, OracleError::NoRecord))
    }

    /// True when no report is stored, it has expired, or its value is outside
    /// the configured band. The NAV pause is not counted; `state` reports it.
    pub fn is_stale(e: &Env) -> bool {
        match get_latest(e) {
            None => true,
            Some(r) => !trustworthy(e, &r),
        }
    }

    /// Succeeds only while `state` is `Valid`.
    ///
    /// # Errors
    ///
    /// * `NotConsumable` - The NAV is paused, or the report is missing,
    ///   expired or out of band.
    pub fn ensure_consumable(e: &Env) {
        guards::consumable(e);
    }

    /// Stores a valuation and its proof for the vault to price epochs from.
    /// The stored `expires_at` is the earlier of the input's and the time of
    /// acceptance plus `freshness_duration`. It never verifies the proof.
    ///
    /// # Arguments
    ///
    /// * `input` - `nav_per_share` in WAD: asset base units per share base
    ///   unit. `expires_at` in seconds: the last moment the attester vouches
    ///   for it. `proof_hash` hashes the evidence; `proof_uri` says where to
    ///   read it, or is empty.
    /// * `caller` - An `attester`.
    ///
    /// # Errors
    ///
    /// * `AccessControlError::Unauthorized` - `caller` is not an `attester`.
    /// * `NavPaused` - The NAV is paused.
    /// * `NavOutOfBand` - `nav_per_share` is outside the band.
    /// * `ExpiresInPast` - `expires_at` is not in the future.
    /// * `EmptyProofHash` - `proof_hash` is all zeros.
    /// * `ProofUriTooLong` - `proof_uri` is over 256 bytes.
    /// * `CooldownActive` - The last report is younger than `cooldown_secs`.
    /// * `DeviationExceeded` - The move from the last report exceeds its cap.
    ///
    /// # Events
    ///
    /// * `NavAttested`
    ///
    /// # Authorization
    ///
    /// `caller` signs.
    #[only_role(caller, "attester")]
    pub fn attest(e: &Env, input: NavInput, caller: Address) {
        guards::nav_not_paused(e);
        let cfg = get_config(e);
        guards::nav_in_band(e, &cfg, input.nav_per_share);
        guards::expires_in_future(e, input.expires_at);
        guards::proof_hash_not_empty(e, &input.proof_hash);
        guards::proof_uri_fits(e, &input.proof_uri);
        if let Some(last) = get_latest(e) {
            guards::cooldown_elapsed(e, &cfg, &last);
            guards::within_deviation(e, &cfg, &last, input.nav_per_share);
        }

        strata_storage::bump_instance(e);
        let now = e.ledger().timestamp();
        let stored = NavReport {
            nav_per_share: input.nav_per_share,
            expires_at: input
                .expires_at
                .min(now.saturating_add(cfg.freshness_duration)),
            accepted_at: now,
            proof_hash: input.proof_hash,
            proof_uri: input.proof_uri,
        };
        state::set_latest(e, &stored);

        NavAttested {
            attester: caller,
            nav_per_share: stored.nav_per_share,
            expires_at: stored.expires_at,
            proof_hash: stored.proof_hash,
            proof_uri: stored.proof_uri,
        }
        .publish(e);
    }

    /// Pauses the NAV: the feed reports `Paused`, no report is accepted and
    /// the vault prices nothing. Only the admin lifts it.
    ///
    /// # Arguments
    ///
    /// * `caller` - A `guardian`.
    ///
    /// # Errors
    ///
    /// * `AccessControlError::Unauthorized` - `caller` is not a `guardian`.
    ///
    /// # Events
    ///
    /// * `NavPausedSet`, with `paused` true.
    ///
    /// # Authorization
    ///
    /// `caller` signs.
    #[only_role(caller, "guardian")]
    pub fn pause_nav(e: &Env, caller: Address) {
        state::set_nav_paused(e, true);
        NavPausedSet { paused: true }.publish(e);
    }

    /// Pauses the NAV, or lifts the pause.
    ///
    /// # Arguments
    ///
    /// * `paused` - True pauses, false lifts the pause.
    ///
    /// # Events
    ///
    /// * `NavPausedSet`
    ///
    /// # Authorization
    ///
    /// The admin signs.
    #[only_admin]
    pub fn set_nav_paused(e: &Env, paused: bool) {
        state::set_nav_paused(e, paused);
        NavPausedSet { paused }.publish(e);
    }

    /// Removes the stored record, so one in-band value can land again whatever
    /// its distance from the last. Only while the NAV is paused, so
    /// resuming is always a deliberate second act.
    ///
    /// # Errors
    ///
    /// * `NavNotPaused` - The NAV is not paused.
    ///
    /// # Events
    ///
    /// * `LatestCleared`
    ///
    /// # Authorization
    ///
    /// The admin signs.
    #[only_admin]
    pub fn clear_latest(e: &Env) {
        guards::nav_paused(e);
        state::clear_latest(e);
        LatestCleared {}.publish(e);
    }

    /// The limits a report must meet: `freshness_duration` and
    /// `cooldown_secs` in seconds, `max_up_bps` and `max_down_bps` in basis
    /// points, `min_answer` and `max_answer` in WAD.
    pub fn config(e: &Env) -> OracleConfig {
        get_config(e)
    }

    /// Replaces the limits. Instant during setup. Afterwards, instant only
    /// when the new config changes nothing but a shorter
    /// `freshness_duration`; every other change waits. Propose it as
    /// `OracleChange::Config`.
    ///
    /// # Arguments
    ///
    /// * `config` - The new limits, in the units `config` returns.
    ///
    /// # Errors
    ///
    /// * `InvalidConfig` - `config` breaks a bound.
    /// * `UseTimelock` - After setup, it changes more than a shorter
    ///   `freshness_duration`.
    ///
    /// # Events
    ///
    /// * `ConfigSet`
    ///
    /// # Authorization
    ///
    /// The admin signs.
    #[only_admin]
    pub fn set_config(e: &Env, config: OracleConfig) {
        guards::valid_config(e, &config);
        guards::direct_config_allowed(e, &config);
        store_config(e, &config);
    }
}

#[contractimpl(contracttrait)]
impl OracleFeed for NavOracleContract {
    /// `Paused` while the NAV is paused. Otherwise `Valid` when a report is
    /// stored, unexpired and in band, and `Stale` when not.
    fn state(e: &Env) -> OracleState {
        compute_state(e)
    }

    /// The stored report's value in WAD: asset base units per share base
    /// unit.
    ///
    /// # Errors
    ///
    /// * `NoRecord` - No report is stored.
    fn nav_per_share(e: &Env) -> i128 {
        Self::latest(e).nav_per_share
    }

    /// The ledger time, in seconds, the oracle took the stored report. Not
    /// the valuation date the reporter had in mind.
    ///
    /// # Errors
    ///
    /// * `NoRecord` - No report is stored.
    fn attested_at(e: &Env) -> u64 {
        Self::latest(e).accepted_at
    }

    /// How long a report stays valid after it is accepted, in seconds.
    fn freshness_duration(e: &Env) -> u64 {
        get_config(e).freshness_duration
    }
}

/// Stands in for a later oracle version in the upgrade test. Never deployed.
#[cfg(feature = "upgrade_probe")]
#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum ProbeError {
    AlreadyMigrated = 3100,
}

#[cfg(feature = "upgrade_probe")]
#[contractimpl]
impl NavOracleContract {
    #[only_admin]
    pub fn migrate(e: &Env) {
        strata_storage::bump_instance(e);
        if upgradeable::get_schema_version(e) >= 2 {
            panic_with_error!(e, ProbeError::AlreadyMigrated);
        }
        upgradeable::set_schema_version(e, 2);
    }

    pub fn probe(_e: &Env) -> bool {
        true
    }
}

#[cfg(test)]
mod test;
#[cfg(test)]
mod test_governance;
#[cfg(test)]
mod test_guards;
