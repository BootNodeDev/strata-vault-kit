#![no_std]

mod governance;
mod guards;
mod state;

use soroban_sdk::{
    contract, contracterror, contractevent, contractimpl, panic_with_error, Address, Env, Symbol,
    Vec,
};
use stellar_access::access_control::{self, AccessControl};
use stellar_contract_utils::upgradeable;
use stellar_macros::{only_admin, only_role};
use strata_bindings::{OracleFeed, VaultBinding};

use state::{get_config, get_latest, nav_paused, ATTESTER_ROLE, GUARDIAN_ROLE};

pub use governance::{
    shortens_freshness_only, OracleChange, OraclePendingChange, ADMIN_ACCEPT_LEDGERS,
};
pub use state::{NavReport, OracleConfig, OracleState};

const BPS_DENOM: i128 = 10_000;
const WAD: i128 = 1_000_000_000_000_000_000;

/// One report per ledger at most. A deployment sets a longer cooldown.
pub const MIN_COOLDOWN_SECS: u64 = 1;
/// Thirty-five days: a monthly valuation with slack, and no longer.
pub const MAX_FRESHNESS_SECS: u64 = 35 * strata_timelock::DAY_DURATION;
/// A million units of the asset per share. Far above any real price, and far
/// below where the deviation arithmetic could overflow.
pub const MAX_ANSWER: i128 = 1_000_000 * WAD;

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum OracleError {
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
    NoRecord = 3006,
    /// `ensure_consumable` found the feed in a state other than `Valid`.
    NotConsumable = 3007,
    /// `clear_latest` was called while the NAV was not paused.
    NavNotPaused = 3008,
    /// The oracle must always have an admin. Hand it over instead: propose and
    /// apply an `Admin` change (`transfer_admin_role` during setup), then the
    /// nominee calls `accept_admin_transfer`.
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
    /// The vault is winding down, so no change may be proposed or applied.
    WindDownActive = 3018,
    /// The vault is paused, which holds every timelocked change.
    VaultPaused = 3019,
    /// The change's delay is shorter than the vault's notice, so an investor
    /// could not complete an exit before it lands.
    DelayBelowNotice = 3020,
    /// An upgrade already waits. Cancel it before proposing another.
    UpgradeAlreadyPending = 3021,
    /// An admin hand-over offered during setup is still open. Setup finishes
    /// once it is accepted, cancelled or expired, so no nominee from setup can
    /// accept after changes start to wait.
    AdminTransferPending = 3025,
    /// The configuration the constructor writes is absent from instance
    /// storage.
    NotInitialized = 3026,
}

#[contractevent]
pub struct NavAttested {
    #[topic]
    pub attester: Address,
    pub nav_per_share: i128,
    pub expires_at: u64,
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
    /// Instant during setup; after it, propose the grant through the timelock.
    /// Revoking stays instant: taking an attester or a guardian away moves no
    /// value.
    fn grant_role(e: &Env, account: Address, role: Symbol, caller: Address) {
        guards::direct_change_allowed(e);
        strata_storage::bump_instance(e);
        access_control::grant_role(e, &account, &role, &caller);
    }

    /// Cancelling a pending hand-over (`live_until_ledger == 0`) keeps the
    /// current admin, so it stays instant.
    fn transfer_admin_role(e: &Env, new_admin: Address, live_until_ledger: u32) {
        guards::direct_hand_over_allowed(e, live_until_ledger);
        strata_storage::bump_instance(e);
        access_control::transfer_admin_role(e, &new_admin, live_until_ledger);
    }

    /// Refused. A role admin could grant that role with no delay.
    fn set_role_admin(e: &Env, _role: Symbol, _admin_role: Symbol) {
        panic_with_error!(e, OracleError::UseTimelock);
    }

    /// Refused. An oracle with no admin can never be reconfigured, never clear a
    /// stuck record and never unpause the NAV again. The way out is a hand-over:
    /// propose and apply an `Admin` change (`transfer_admin_role` during setup),
    /// then the nominee calls `accept_admin_transfer`.
    fn renounce_admin(e: &Env) {
        panic_with_error!(e, OracleError::AdminRequired);
    }
}

#[contractimpl(contracttrait)]
impl VaultBinding for NavOracleContract {
    fn vault(e: &Env) -> Option<Address> {
        strata_timelock::setup::source(e)
    }

    fn setup_open(e: &Env) -> bool {
        strata_timelock::setup::is_open(e)
    }
}

#[contractimpl]
impl NavOracleContract {
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
        access_control::grant_role_no_auth(e, &guardian, &GUARDIAN_ROLE, &admin);

        state::set_config(e, &config);
        state::set_nav_paused(e, false);
        upgradeable::set_schema_version(e, 1);
    }

    pub fn schema_version(e: &Env) -> u32 {
        upgradeable::get_schema_version(e)
    }

    /// Names the vault whose clock this oracle's timelock reads. Once, and only
    /// during setup.
    #[only_admin]
    pub fn bind_vault(e: &Env, vault: Address) {
        strata_storage::bump_instance(e);
        governance::bind_vault(e, &vault);
    }

    /// Ends the window in which admin changes are instant. It never reopens.
    #[only_admin]
    pub fn finish_setup(e: &Env) {
        strata_storage::bump_instance(e);
        governance::finish_setup(e);
    }

    /// Queues a change behind the vault's timelock and returns its id.
    #[only_admin]
    pub fn propose_change(e: &Env, change: OracleChange) -> u32 {
        strata_storage::bump_instance(e);
        governance::propose(e, change)
    }

    #[only_admin]
    pub fn cancel_change(e: &Env, id: u32) {
        strata_storage::bump_instance(e);
        governance::cancel(e, id);
    }

    /// Lands a change whose delay has run. Refused while the vault is paused
    /// or winding down.
    #[only_admin]
    pub fn apply_change(e: &Env, id: u32) {
        strata_storage::bump_instance(e);
        governance::apply(e, id);
    }

    pub fn pending_changes(e: &Env) -> Vec<OraclePendingChange> {
        governance::pending(e)
    }

    pub fn latest(e: &Env) -> NavReport {
        get_latest(e).unwrap_or_else(|| panic_with_error!(e, OracleError::NoRecord))
    }

    pub fn is_stale(e: &Env) -> bool {
        match get_latest(e) {
            None => true,
            Some(r) => !trustworthy(e, &r),
        }
    }

    pub fn ensure_consumable(e: &Env) {
        guards::consumable(e);
    }

    #[only_role(caller, "attester")]
    pub fn attest(e: &Env, report: NavReport, caller: Address) {
        guards::nav_not_paused(e);
        let cfg = get_config(e);
        guards::nav_in_band(e, &cfg, report.nav_per_share);
        guards::expires_in_future(e, report.expires_at);
        if let Some(last) = get_latest(e) {
            guards::cooldown_elapsed(e, &cfg, &last);
            guards::within_deviation(e, &cfg, &last, report.nav_per_share);
        }

        strata_storage::bump_instance(e);
        let now = e.ledger().timestamp();
        let stored = NavReport {
            nav_per_share: report.nav_per_share,
            timestamp: now,
            expires_at: report
                .expires_at
                .min(now.saturating_add(cfg.freshness_duration)),
        };
        state::set_latest(e, &stored);

        NavAttested {
            attester: caller,
            nav_per_share: stored.nav_per_share,
            expires_at: stored.expires_at,
        }
        .publish(e);
    }

    #[only_role(caller, "guardian")]
    pub fn pause_nav(e: &Env, caller: Address) {
        state::set_nav_paused(e, true);
        NavPausedSet { paused: true }.publish(e);
    }

    #[only_admin]
    pub fn set_nav_paused(e: &Env, paused: bool) {
        state::set_nav_paused(e, paused);
        NavPausedSet { paused }.publish(e);
    }

    /// Removes the stored record, so one in-band value can land again whatever
    /// its distance from the last. Only while the NAV is paused, so
    /// resuming is always a deliberate second act.
    #[only_admin]
    pub fn clear_latest(e: &Env) {
        guards::nav_paused(e);
        state::clear_latest(e);
        LatestCleared {}.publish(e);
    }

    pub fn config(e: &Env) -> OracleConfig {
        get_config(e)
    }

    /// Instant during setup. Afterwards, instant only when the new config
    /// changes nothing but a shorter `freshness_duration`; every other change
    /// waits. Propose it as `OracleChange::Config`.
    #[only_admin]
    pub fn set_config(e: &Env, config: OracleConfig) {
        guards::valid_config(e, &config);
        guards::direct_config_allowed(e, &config);
        store_config(e, &config);
    }
}

#[contractimpl(contracttrait)]
impl OracleFeed for NavOracleContract {
    fn state(e: &Env) -> OracleState {
        compute_state(e)
    }

    fn nav_per_share(e: &Env) -> i128 {
        Self::latest(e).nav_per_share
    }

    /// Not the valuation date the reporter had in mind: the moment the
    /// contract took the report.
    fn attested_at(e: &Env) -> u64 {
        Self::latest(e).timestamp
    }

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
