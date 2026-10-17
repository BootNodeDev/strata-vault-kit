#![no_std]

mod state;

use bindings::OracleFeed;
use soroban_sdk::{
    contract, contracterror, contractevent, contractimpl, panic_with_error, Address, Env, Symbol,
    Vec,
};
use stellar_access::access_control::{self, AccessControl};
use stellar_macros::{only_admin, only_role};

use state::{get_config, get_latest, nav_paused, ATTESTER_ROLE, GUARDIAN_ROLE};

pub use state::{NavReport, OracleConfig, OracleState};

const BPS_DENOM: i128 = 10_000;
const WAD: i128 = 1_000_000_000_000_000_000;

/// One report per ledger at most. A deployment sets a longer cooldown.
pub const MIN_COOLDOWN_SECS: u64 = 1;
/// Thirty-five days: a monthly valuation with slack, and no longer.
pub const MAX_FRESHNESS_SECS: u64 = 35 * timelock::DAY_DURATION;
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
    /// Per-share move exceeds `max_deviation_bps`.
    DeviationExceeded = 3004,
    /// `expires_at` not in the future — the record would be born stale.
    ExpiresInPast = 3005,
    NoRecord = 3006,
    /// `ensure_consumable` found the feed in a state other than `Valid`.
    NotConsumable = 3007,
    /// `clear_latest` was called while the NAV was not paused.
    NavNotPaused = 3008,
    /// The oracle must always have an admin.
    AdminRequired = 3009,
    /// The NAV is paused. Unpause it first; a report never lifts it.
    NavPaused = 3010,
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
pub struct ConfigSet {
    pub freshness_duration: u64,
    pub cooldown_secs: u64,
    pub max_up_bps: u32,
    pub max_down_bps: u32,
    pub min_answer: i128,
    pub max_answer: i128,
}

fn bps_in_range(bps: u32) -> bool {
    bps > 0 && bps as i128 <= BPS_DENOM
}

fn validate_config(e: &Env, cfg: &OracleConfig) {
    if cfg.freshness_duration == 0
        || cfg.freshness_duration > MAX_FRESHNESS_SECS
        || cfg.cooldown_secs < MIN_COOLDOWN_SECS
        || cfg.cooldown_secs > cfg.freshness_duration
        || cfg.min_answer <= 0
        || cfg.max_answer < cfg.min_answer
        || cfg.max_answer > MAX_ANSWER
        || !bps_in_range(cfg.max_up_bps)
        || !bps_in_range(cfg.max_down_bps)
    {
        panic_with_error!(e, OracleError::InvalidConfig);
    }
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
    /// Refused. An oracle with no admin can never be reconfigured, never clear a
    /// stuck record and never unpause the NAV again.
    fn renounce_admin(e: &Env) {
        panic_with_error!(e, OracleError::AdminRequired);
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
        validate_config(e, &config);
        access_control::set_admin(e, &admin);
        access_control::grant_role_no_auth(e, &attester, &ATTESTER_ROLE, &admin);
        access_control::grant_role_no_auth(e, &guardian, &GUARDIAN_ROLE, &admin);

        state::set_config(e, &config);
        state::set_nav_paused(e, false);
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
        if compute_state(e) != OracleState::Valid {
            panic_with_error!(e, OracleError::NotConsumable);
        }
    }

    #[only_role(caller, "attester")]
    pub fn attest(e: &Env, report: NavReport, caller: Address) {
        storage::bump_instance(e);
        if nav_paused(e) {
            panic_with_error!(e, OracleError::NavPaused);
        }
        let cfg = get_config(e);
        let now = e.ledger().timestamp();

        if !in_band(&cfg, report.nav_per_share) {
            panic_with_error!(e, OracleError::NavOutOfBand);
        }
        if report.expires_at <= now {
            // should never happen
            panic_with_error!(e, OracleError::ExpiresInPast);
        }

        if let Some(prev) = get_latest(e) {
            if now < prev.timestamp.saturating_add(cfg.cooldown_secs) {
                panic_with_error!(e, OracleError::CooldownActive);
            }
            let bps = if report.nav_per_share >= prev.nav_per_share {
                cfg.max_up_bps
            } else {
                cfg.max_down_bps
            };
            let diff = (report.nav_per_share - prev.nav_per_share).abs();
            let bound = prev.nav_per_share * (bps as i128) / BPS_DENOM;
            if diff > bound {
                panic_with_error!(e, OracleError::DeviationExceeded);
            }
        }

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
    pub fn set_nav_paused(e: &Env, paused: bool, caller: Address) {
        caller.require_auth();
        state::set_nav_paused(e, paused);
        NavPausedSet { paused }.publish(e);
    }

    /// Removes the stored record, so one in-band value can land again whatever
    /// its distance from the last. Only while the NAV is paused, so
    /// resuming is always a deliberate second act.
    #[only_admin]
    pub fn clear_latest(e: &Env, caller: Address) {
        caller.require_auth();
        if !nav_paused(e) {
            panic_with_error!(e, OracleError::NavNotPaused);
        }
        state::clear_latest(e);
        LatestCleared {}.publish(e);
    }

    pub fn config(e: &Env) -> OracleConfig {
        get_config(e)
    }

    #[only_admin]
    pub fn set_config(e: &Env, config: OracleConfig) {
        validate_config(e, &config);
        state::set_config(e, &config);
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

#[cfg(test)]
mod test;
