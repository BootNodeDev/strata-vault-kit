use soroban_sdk::{contracttype, symbol_short, Env, Symbol};

/// The three-state feed health
//
// - `Valid`:  the NAV is not paused AND now ≤ expires_at
//             AND min_answer ≤ nav_per_share ≤ max_answer. Mint AND redeem.
// - `Stale`:  the NAV is not paused but past heartbeat/expires_at (or no record yet).
//             Value untrusted; BOTH mint and redeem halt.
// - `Paused`: the NAV is paused (issuer freeze). Value ignored entirely, both
//             directions, until the issuer clears the NAV pause.
pub use bindings::OracleState;

pub const ATTESTER_ROLE: Symbol = symbol_short!("attester");

/// Pauses the NAV in an emergency. Cannot unpause it.
pub const GUARDIAN_ROLE: Symbol = symbol_short!("guardian");

/// A valuation. On input, `expires_at` is the latest moment the reporter
/// vouches for it, and `timestamp` is ignored. As stored, `timestamp` is the
/// ledger time the oracle accepted the report, and `expires_at` is the
/// reporter's expiry capped at that time plus `freshness_duration`.
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
    /// Downward move allowed per attestation, 1 to 10,000. At 10,000 a loss of
    /// any size lands in one attestation and `min_answer` is the only floor.
    pub max_down_bps: u32,
    pub min_answer: i128,
    pub max_answer: i128,
}

#[contracttype]
pub(crate) enum DataKey {
    Config,
    Latest,
    NavPaused,
}

pub(crate) fn set_config(e: &Env, config: &OracleConfig) {
    storage::set_instance(e, &DataKey::Config, config);
}

pub(crate) fn get_config(e: &Env) -> OracleConfig {
    storage::get_instance(e, &DataKey::Config).unwrap()
}

pub(crate) fn set_nav_paused(e: &Env, paused: bool) {
    storage::set_instance(e, &DataKey::NavPaused, &paused);
}

pub(crate) fn nav_paused(e: &Env) -> bool {
    storage::get_instance(e, &DataKey::NavPaused).unwrap_or(false)
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
