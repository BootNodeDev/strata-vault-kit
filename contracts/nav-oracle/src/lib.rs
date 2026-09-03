#![no_std]

use soroban_sdk::{
    contract, contracterror, contractevent, contractimpl, contracttype, panic_with_error,
    symbol_short, Address, Env, Symbol,
};
use stellar_access::access_control;
use stellar_macros::{only_admin, only_role};

const BPS_DENOM: i128 = 10_000;

const DAY_IN_LEDGERS: u32 = 17280;
const PERSISTENT_EXTEND: u32 = 120 * DAY_IN_LEDGERS;
const PERSISTENT_THRESHOLD: u32 = PERSISTENT_EXTEND - DAY_IN_LEDGERS;
const INSTANCE_EXTEND: u32 = 120 * DAY_IN_LEDGERS;
const INSTANCE_THRESHOLD: u32 = INSTANCE_EXTEND - DAY_IN_LEDGERS;

fn bump_instance(e: &Env) {
    e.storage()
        .instance()
        .extend_ttl(INSTANCE_THRESHOLD, INSTANCE_EXTEND);
}

const ATTESTER_ROLE: Symbol = symbol_short!("attester");

/// The three-state feed health
//
// - `Valid`:  ripcord=0 AND now ≤ expires_at
//             AND min_answer ≤ nav_per_share ≤ max_answer. Mint AND redeem.
// - `Stale`:  ripcord=0 but past heartbeat/expires_at (or no record yet).
//             Value untrusted; BOTH mint and redeem halt.
// - `Paused`: ripcord=1 (issuer freeze). Value ignored entirely, both
//             directions, until the issuer clears ripcord to 0.
pub use bindings::OracleState;

#[contracttype]
#[derive(Clone)]
pub struct NavReport {
    pub nav_per_share: i128,
    pub expires_at: u64,
    pub timestamp: u64,
}

#[contracttype]
#[derive(Clone)]
pub struct OracleConfig {
    pub freshness_duration: u64, // before nav is considered stale
    pub cooldown_secs: u64,      // before new record is admitted
    pub max_deviation_bps: u32,
    pub min_answer: i128,
    pub max_answer: i128,
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum OracleError {
    NotAuthorized = 3000,
    InvalidConfig = 3001,
    /// `nav_per_share <= 0`, or outside `[min_answer, max_answer]`.
    NavOutOfBand = 3002,
    /// Attested before `cooldown_secs` elapsed since the last record.
    CooldownActive = 3003,
    /// Per-share move exceeds `max_deviation_bps`.
    DeviationExceeded = 3004,
    /// `nav_date` not strictly greater than the previous record.
    /// `expires_at` not in the future — the record would be born stale.
    ExpiresInPast = 3005,
    NoRecord = 3006,
    /// `ensure_consumable` gate: feed is not `Valid`.
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

pub trait NavOracle {
    fn nav_per_share(e: &Env) -> i128;
    fn latest(e: &Env) -> NavReport;
    fn state(e: &Env) -> OracleState;
    fn is_stale(e: &Env) -> bool;
    fn ensure_consumable(e: &Env);
    fn attest(e: &Env, report: NavReport, caller: Address);
    fn set_ripcord(e: &Env, paused: bool, caller: Address);
}

#[contracttype]
enum DataKey {
    Config,
    Latest,
    Ripcord,
}

fn get_config(e: &Env) -> OracleConfig {
    e.storage().instance().get(&DataKey::Config).unwrap()
}

fn get_latest(e: &Env) -> Option<NavReport> {
    let latest: Option<NavReport> = e.storage().persistent().get(&DataKey::Latest);
    if latest.is_some() {
        e.storage().persistent().extend_ttl(
            &DataKey::Latest,
            PERSISTENT_THRESHOLD,
            PERSISTENT_EXTEND,
        );
    }
    latest
}

fn ripcord_raised(e: &Env) -> bool {
    e.storage()
        .instance()
        .get(&DataKey::Ripcord)
        .unwrap_or(false)
}

fn compute_state(e: &Env) -> OracleState {
    if ripcord_raised(e) {
        return OracleState::Paused;
    }
    match get_latest(e) {
        None => OracleState::Stale,
        Some(r) => {
            let now = e.ledger().timestamp();
            if now > r.expires_at {
                OracleState::Stale
            } else {
                OracleState::Valid
            }
        }
    }
}

#[contract]
pub struct NavOracleContract;

#[contractimpl]
impl NavOracleContract {
    pub fn __constructor(e: &Env, admin: Address, attester: Address, config: OracleConfig) {
        if config.min_answer <= 0 || config.max_answer < config.min_answer {
            panic_with_error!(e, OracleError::InvalidConfig);
        }
        access_control::set_admin(e, &admin);
        access_control::grant_role_no_auth(e, &attester, &ATTESTER_ROLE, &admin);

        let s = e.storage().instance();
        s.set(&DataKey::Config, &config);
        s.set(&DataKey::Ripcord, &false);
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
            Some(r) => {
                let now = e.ledger().timestamp();
                now > r.expires_at
            }
        }
    }

    pub fn ensure_consumable(e: &Env) {
        if compute_state(e) != OracleState::Valid {
            panic_with_error!(e, OracleError::NotConsumable);
        }
    }

    #[only_role(caller, "attester")]
    pub fn attest(e: &Env, report: NavReport, caller: Address) {
        bump_instance(e);
        let cfg = get_config(e);
        let now = e.ledger().timestamp();

        if report.nav_per_share < cfg.min_answer || report.nav_per_share > cfg.max_answer {
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
            // Per-share symmetric deviation cap against the previous strike.
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
        e.storage().persistent().set(&DataKey::Latest, &stored);
        e.storage().persistent().extend_ttl(
            &DataKey::Latest,
            PERSISTENT_THRESHOLD,
            PERSISTENT_EXTEND,
        );

        NavAttested {
            attester: caller,
            nav_per_share: stored.nav_per_share,
            expires_at: stored.expires_at,
        }
        .publish(e);
    }

    #[only_admin]
    pub fn set_ripcord(e: &Env, paused: bool, _caller: Address) {
        bump_instance(e);
        e.storage().instance().set(&DataKey::Ripcord, &paused);
        RipcordSet { paused }.publish(e);
    }

    #[only_admin]
    pub fn set_config(e: &Env, config: OracleConfig) {
        if config.freshness_duration == 0
            || config.min_answer <= 0
            || config.max_answer < config.min_answer
        {
            panic_with_error!(e, OracleError::InvalidConfig);
        }
        bump_instance(e);
        e.storage().instance().set(&DataKey::Config, &config);
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
