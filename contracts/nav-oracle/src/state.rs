use soroban_sdk::{contracttype, symbol_short, Env, Symbol};

/// The three-state feed health
//
// - `Valid`:  ripcord=0 AND now ≤ expires_at
//             AND min_answer ≤ nav_per_share ≤ max_answer. Mint AND redeem.
// - `Stale`:  ripcord=0 but past heartbeat/expires_at (or no record yet).
//             Value untrusted; BOTH mint and redeem halt.
// - `Paused`: ripcord=1 (issuer freeze). Value ignored entirely, both
//             directions, until the issuer clears ripcord to 0.
pub use bindings::OracleState;

pub const ATTESTER_ROLE: Symbol = symbol_short!("attester");

/// Raises the ripcord in an emergency. Cannot lower it again.
pub const GUARDIAN_ROLE: Symbol = symbol_short!("guardian");

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
    /// Upward move allowed per attestation. Always set, never zero.
    pub max_up_bps: u32,
    /// Downward move allowed per attestation. `None` leaves falls uncapped, so a
    /// loss of any size lands in one attestation. With it unset, `min_answer` is
    /// the only bound on a single report, which makes that floor a risk
    /// parameter rather than a sanity check.
    pub max_down_bps: Option<u32>,
    pub min_answer: i128,
    pub max_answer: i128,
}

#[contracttype]
pub(crate) enum DataKey {
    Config,
    Latest,
    Ripcord,
}

pub(crate) fn set_config(e: &Env, config: &OracleConfig) {
    storage::set_instance(e, &DataKey::Config, config);
}

pub(crate) fn get_config(e: &Env) -> OracleConfig {
    storage::get_instance(e, &DataKey::Config).unwrap()
}

pub(crate) fn set_ripcord(e: &Env, paused: bool) {
    storage::set_instance(e, &DataKey::Ripcord, &paused);
}

pub(crate) fn ripcord_raised(e: &Env) -> bool {
    storage::get_instance(e, &DataKey::Ripcord).unwrap_or(false)
}

pub(crate) fn set_latest(e: &Env, report: &NavReport) {
    storage::set_persistent(e, &DataKey::Latest, report);
}

pub(crate) fn clear_latest(e: &Env) {
    e.storage().persistent().remove(&DataKey::Latest);
}

pub(crate) fn get_latest(e: &Env) -> Option<NavReport> {
    storage::get_persistent(e, &DataKey::Latest)
}
