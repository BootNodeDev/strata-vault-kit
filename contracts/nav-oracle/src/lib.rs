#![no_std]

mod state;

use soroban_sdk::{
    contract, contracterror, contractevent, contractimpl, panic_with_error, Address, Env,
};
use stellar_access::access_control;
use stellar_macros::{only_admin, only_role};

use state::{get_config, get_latest, ripcord_raised, ATTESTER_ROLE, GUARDIAN_ROLE};

pub use state::{NavReport, OracleConfig, OracleState};

const BPS_DENOM: i128 = 10_000;
const MAX_ANSWER: i128 = i128::MAX / BPS_DENOM;

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
}

#[contractevent]
pub struct NavAttested {
    #[topic]
    pub attester: Address,
    pub nav_per_share: i128,
    pub expires_at: u64,
}

#[contractevent]
pub struct RipcordSet {
    pub paused: bool,
}

#[contractevent]
pub struct ConfigSet {
    pub freshness_duration: u64,
    pub cooldown_secs: u64,
    pub max_deviation_bps: u32,
    pub min_answer: i128,
    pub max_answer: i128,
}

fn validate_config(e: &Env, cfg: &OracleConfig) {
    if cfg.freshness_duration == 0
        || cfg.min_answer <= 0
        || cfg.max_answer < cfg.min_answer
        || cfg.max_answer > MAX_ANSWER
        || cfg.max_deviation_bps as i128 > BPS_DENOM
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
    if ripcord_raised(e) {
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
        state::set_ripcord(e, false);
    }

    pub fn nav_per_share(e: &Env) -> i128 {
        Self::latest(e).nav_per_share
    }

    pub fn latest(e: &Env) -> NavReport {
        get_latest(e).unwrap_or_else(|| panic_with_error!(e, OracleError::NoRecord))
    }

    pub fn state(e: &Env) -> OracleState {
        compute_state(e)
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
            // Per-share symmetric deviation cap against the previous record.
            let diff = (report.nav_per_share - prev.nav_per_share).abs();
            let bound = prev.nav_per_share * (cfg.max_deviation_bps as i128) / BPS_DENOM;
            if diff > bound {
                panic_with_error!(e, OracleError::DeviationExceeded);
            }
        }

        let stored = NavReport {
            nav_per_share: report.nav_per_share,
            timestamp: now,
            expires_at: now.saturating_add(cfg.freshness_duration),
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
    pub fn raise_ripcord(e: &Env, caller: Address) {
        state::set_ripcord(e, true);
        RipcordSet { paused: true }.publish(e);
    }

    #[only_admin]
    pub fn set_ripcord(e: &Env, paused: bool, _caller: Address) {
        state::set_ripcord(e, paused);
        RipcordSet { paused }.publish(e);
    }

    #[only_admin]
    pub fn set_config(e: &Env, config: OracleConfig) {
        validate_config(e, &config);
        state::set_config(e, &config);
        ConfigSet {
            freshness_duration: config.freshness_duration,
            cooldown_secs: config.cooldown_secs,
            max_deviation_bps: config.max_deviation_bps,
            min_answer: config.min_answer,
            max_answer: config.max_answer,
        }
        .publish(e);
    }
}

#[cfg(test)]
mod test;
