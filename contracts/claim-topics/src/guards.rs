use soroban_sdk::{panic_with_error, Address, Env, Executable};
use stellar_access::{
    access_control::{self, AccessControlStorageKey},
    role_transfer,
};
use strata_timelock::{setup, TimelockHost};

use crate::governance;
use crate::{ClaimTopics, ClaimTopicsContractError};

pub(crate) fn setup_open(e: &Env) {
    if !setup::is_open(e) {
        panic_with_error!(e, ClaimTopicsContractError::SetupClosed);
    }
}

/// No nominee from setup may accept once changes wait, so a hand-over offered
/// during setup holds it open.
pub(crate) fn no_hand_over_pending(e: &Env) {
    if role_transfer::has_active_pending_transfer(e, &AccessControlStorageKey::PendingAdmin) {
        panic_with_error!(e, ClaimTopicsContractError::AdminTransferPending);
    }
}

/// Passes before a vault is bound: there is no wind-down to read yet.
pub(crate) fn vault_not_winding_down(e: &Env) {
    if <ClaimTopics as TimelockHost>::clock(e).is_ok_and(|clock| clock.winding_down) {
        panic_with_error!(e, ClaimTopicsContractError::WindDownActive);
    }
}

/// Direct changes are instant only before setup finishes.
pub(crate) fn direct_change_allowed(e: &Env) {
    if !setup::is_open(e) {
        panic_with_error!(e, ClaimTopicsContractError::UseTimelock);
    }
}

/// Only an offer needs setup open; cancelling one (`0`) keeps the admin.
pub(crate) fn direct_hand_over_allowed(e: &Env, live_until_ledger: u32) {
    if live_until_ledger != 0 {
        direct_change_allowed(e);
    }
}

pub(crate) fn operator_is_admin(e: &Env, operator: &Address) {
    if access_control::get_admin(e).as_ref() != Some(operator) {
        panic_with_error!(e, ClaimTopicsContractError::OperatorNotAdmin);
    }
}

pub(crate) fn runs_kit_issuer_code(e: &Env, issuer: &Address) {
    let kit = Executable::Wasm(governance::issuer_wasm(e));
    if issuer.executable() != Some(kit) {
        panic_with_error!(e, ClaimTopicsContractError::NotKitIssuer);
    }
}
