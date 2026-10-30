use soroban_sdk::{panic_with_error, Env};
use stellar_access::{access_control::AccessControlStorageKey, role_transfer};
use strata_timelock::{setup, TimelockHost};

use crate::{Compliance, ComplianceContractError};

pub(crate) fn setup_open(e: &Env) {
    if !setup::is_open(e) {
        panic_with_error!(e, ComplianceContractError::SetupClosed);
    }
}

/// No nominee from setup may accept once changes wait, so a hand-over offered
/// during setup holds it open.
pub(crate) fn no_hand_over_pending(e: &Env) {
    if role_transfer::has_active_pending_transfer(e, &AccessControlStorageKey::PendingAdmin) {
        panic_with_error!(e, ComplianceContractError::AdminTransferPending);
    }
}

/// Passes before a vault is bound: there is no wind-down to read yet.
pub(crate) fn vault_not_winding_down(e: &Env) {
    if <Compliance as TimelockHost>::clock(e).is_ok_and(|clock| clock.winding_down) {
        panic_with_error!(e, ComplianceContractError::WindDownActive);
    }
}

/// Direct rule changes are instant only before setup finishes.
pub(crate) fn direct_change_allowed(e: &Env) {
    if !setup::is_open(e) {
        panic_with_error!(e, ComplianceContractError::UseTimelock);
    }
}

/// Only an offer needs setup open; cancelling one (`0`) keeps the admin.
pub(crate) fn direct_hand_over_allowed(e: &Env, live_until_ledger: u32) {
    if live_until_ledger != 0 {
        direct_change_allowed(e);
    }
}
