#![no_std]
mod contract;
mod error;
mod event;
mod governance;
mod roles;
pub use contract::*;
pub use error::ShareTokenError;
pub use event::{ChangeApplied, ChangeCancelled, ChangeProposed, SetupFinished, VaultBound};
pub use governance::{TokenChange, TokenPendingChange, ADMIN_ACCEPT_LEDGERS};

#[cfg(test)]
mod test;
#[cfg(test)]
mod test_governance;
