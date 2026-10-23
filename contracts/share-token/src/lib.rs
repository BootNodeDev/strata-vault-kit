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
