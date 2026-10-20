//! # Design
//!
//! The vault's share token: OpenZeppelin's RWA token, which asks the identity
//! verifier about every receiver and the compliance contract about every move.
//! The kit adds its roles, its guards and the vault's timelock.
//!
//! - **No clock of its own.** After setup, upgrades, grants, revoking
//!   `manager`, admin hand-overs and compliance or verifier swaps wait for the
//!   vault's timelock. Revoking `compliance` and the transfer pause stay
//!   instant. The cost: a paused vault holds every token change, and none
//!   lands during a wind-down.
//! - **The vault is the only manager.** `mint`, `burn` and `forced_transfer`
//!   need `manager`, which the vault must hold alone for its setup to finish.
//!   `forced_transfer` skips the pause, freezes, the identity check and the
//!   compliance rules' check, so the vault checks the receiver itself before it
//!   returns shares. The cost: a `manager` can move any holder's shares without
//!   their signature, so after setup granting or revoking it waits for the
//!   timelock.
//! - **Two signers move a holder's shares.** `legal_transfer` and
//!   `recover_balance` need a `compliance` holder and the admin to sign as two
//!   different accounts, and the shares land only on an allowlisted account.
//!   The cost: a legal order needs both signers. A legal transfer of zero
//!   shares is accepted: it moves nothing but publishes its order reference.
//! - **The vault's address is off limits.** Once the token is bound to the
//!   vault, its address cannot be frozen, in full or in part, and no legal
//!   transfer or recovery moves shares into or out of it: its balance is other
//!   holders' escrow. The cost: an order cannot reach shares escrowed in the
//!   vault; compliance freezes the holder instead, which holds that holder's
//!   exits.
//! - **The pause halts trading only.** The transfer pause is the admin's, not
//!   the guardian's. It stops `transfer` and `transfer_from`; mints, burns,
//!   escrow moves and legal transfers go on. The cost: it is not an emergency
//!   stop for the vault.
//! - **A compliance swap is not checked.** Swapping the compliance contract
//!   does not check that the new contract lists this token. The cost: if it
//!   does not, every mint, transfer and burn fails until it binds the token,
//!   and the vault's `health()` reports `compliance_bound` false.

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
