//! # Design
//!
//! The vault's share token: OpenZeppelin's RWA token, which checks identity and
//! the compliance rules on every `transfer` and mint; forced transfers skip
//! both. The kit adds its roles, its guards and the vault's timelock.
//!
//! - **No clock of its own.** After setup, upgrades, grants, `manager` revokes,
//!   hand-overs and swaps wait for the vault's timelock. The cost: a vault
//!   pause holds them; a wind-down refuses all but a `compliance` grant,
//!   which moves no value and is the only way to lift a freeze then.
//! - **Only the vault is manager.** It mints, burns and moves anyone's shares;
//!   a forced move skips the token's checks, so the vault checks receivers. The
//!   cost: granting it waits; revoking too, as claims need it.
//! - **Two signers move a holder's shares.** A legal transfer or recovery needs
//!   `compliance` and the admin, as two accounts. The cost: an order needs
//!   both. A zero-share order passes and is published.
//! - **The vault's address is off limits:** once bound, it is never frozen,
//!   no order or transfer moves shares in, and no order moves them out, since
//!   it holds others' escrow. The cost: orders cannot reach escrow; a frozen
//!   holder's exits wait.
//! - **The pause halts trading only.** The admin's transfer pause stops
//!   `transfer` and `transfer_from`; mints, burns, escrow moves and legal
//!   transfers go on. The cost: it is no emergency stop for the vault.
//! - **A swap must fit the vault.** New rules must list this token, and rules
//!   that answer `VaultBinding` must run on the vault's clock with their setup
//!   closed; a new verifier must accept the vault. Both are checked when
//!   proposed and when applied. The cost: as at setup, an external module that
//!   does not answer is taken on trust, and its rules can change with no delay.

#![no_std]
mod contract;
mod error;
mod event;
mod extend;
mod governance;
mod guards;
mod roles;
pub use contract::*;
pub use error::ShareTokenError;
pub use event::{
    ChangeApplied, ChangeCancelled, ChangeProposed, LegalTransfer, SetupFinished, VaultBound,
};
pub use governance::{TokenChange, TokenPendingChange, ADMIN_ACCEPT_LEDGERS};

#[cfg(test)]
mod test;
#[cfg(test)]
mod test_governance;
#[cfg(test)]
mod test_guards;
#[cfg(test)]
mod test_ttl;
