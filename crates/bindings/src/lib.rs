#![no_std]

use soroban_sdk::{contracttrait, contracttype, Env};

#[contracttype]
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum OracleState {
    Valid,
    Stale,
    Paused,
}

/// The feed a vault prices epochs from. The kit's oracle implements it, and
/// so does any feed an adopter brings: the compiler checks both sides.
#[contracttrait]
pub trait OracleFeed {
    fn state(e: &Env) -> OracleState;
    fn nav_per_share(e: &Env) -> i128;
    /// Ledger time the standing report was accepted.
    fn attested_at(e: &Env) -> u64;
    /// How long a report stays valid after it is accepted.
    fn freshness_duration(e: &Env) -> u64;
}
