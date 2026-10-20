//! # Design
//!
//! The interfaces the kit's contracts share, and each contract's block of
//! error codes.
//!
//! - **The compiler checks the feed.** The vault prices from `OracleFeed`,
//!   which the kit's oracle and any feed an adopter brings both implement. The
//!   cost: a feed must answer the trait's four calls as written; any other
//!   shape needs an adapter.
//! - **Bound contracts report their binding.** A contract that runs on a
//!   vault's timelock answers `VaultBinding`, and the vault's `finish_setup`
//!   reads it. The cost: a compliance contract that does not answer it is
//!   accepted as an external module, so its own governance is a trust
//!   assumption.
//! - **A block of codes per contract.** Each kit contract owns a block of error
//!   codes, and `error_enum!` fails the build if a code leaves its block or two
//!   blocks overlap, so a code inside the blocks names the contract that raised
//!   it. The cost: a code is never reused, so a removed variant leaves its
//!   number retired.

#![no_std]

mod errors;

use soroban_sdk::{contracttrait, contracttype, Address, Env};

pub use errors::{ErrorRange, COMPLIANCE_ERRORS, ORACLE_ERRORS, TOKEN_ERRORS, VAULT_ERRORS};

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
