//! # Design
//!
//! The interfaces the kit's contracts share, and their error code blocks.
//!
//! - **The compiler checks the feed.** The vault prices from `OracleFeed`,
//!   which the kit's oracle and any adopter's feed implement. The cost: a feed
//!   must answer its four calls as written, or use an adapter.
//! - **Bound contracts report their binding.** The vault's `finish_setup` and
//!   the token's compliance swaps read `VaultBinding`. The cost: both accept a
//!   compliance contract that does not answer it, on trust, as external.
//! - **Fixed blocks of error codes.** The vault, token, oracle, compliance
//!   contract and the SEP-40 feed each own one; `error_enum!` fails the build
//!   outside it, `errors.rs` on overlaps. The cost: removed codes stay
//!   retired.
//! - **The compiler checks the vault's views.** The SEP-40 feed reads
//!   `VaultView`, which the vault implements. The cost: the wind-down types
//!   live here, not in the vault.

#![no_std]

mod errors;

use soroban_sdk::{contracttrait, contracttype, Address, Env};

pub use errors::{
    ErrorRange, COMPLIANCE_ERRORS, FEED_ERRORS, ORACLE_ERRORS, TOKEN_ERRORS, VAULT_ERRORS,
};

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

/// What a contract that runs on a vault's timelock reports to that vault.
#[contracttrait]
pub trait VaultBinding {
    /// The vault whose clock this contract reads, once bound.
    fn vault(e: &Env) -> Option<Address>;
    /// Whether this contract's admin changes are still instant.
    fn setup_open(e: &Env) -> bool;
}

#[contracttype]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum WindDownStatus {
    Proposed,
    Active,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct WindDownInfo {
    pub status: WindDownStatus,
    /// Ledger time the proposal may be activated.
    pub active_at: u64,
    /// Rounds finalised so far. Zero means no snapshot has been taken.
    pub round: u32,
}

/// What a vault answers about itself to a contract that follows it.
#[contracttrait]
pub trait VaultView {
    fn asset(e: &Env) -> Address;
    fn share_token(e: &Env) -> Address;
    fn oracle(e: &Env) -> Address;
    fn wind_down(e: &Env) -> Option<WindDownInfo>;
    /// The account that signs the vault's admin changes, and the feed's.
    fn governance(e: &Env) -> Option<Address>;
}
