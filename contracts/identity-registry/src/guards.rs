use soroban_sdk::{panic_with_error, Address, Env, Val, Vec};
use stellar_access::access_control::AccessControlStorageKey;
use stellar_access::role_transfer;
use stellar_tokens::rwa::identity_verification::identity_registry_storage::IRSError;
use strata_timelock::{setup, TimelockHost};

use crate::registry;
use crate::{governance, IdentityRegistry, IdentityRegistryError};

pub(crate) fn setup_open(e: &Env) {
    if !setup::is_open(e) {
        panic_with_error!(e, IdentityRegistryError::SetupClosed);
    }
}

/// No nominee from setup may accept once changes wait, so a hand-over offered
/// during setup holds it open.
pub(crate) fn no_hand_over_pending(e: &Env) {
    if role_transfer::has_active_pending_transfer(e, &AccessControlStorageKey::PendingAdmin) {
        panic_with_error!(e, IdentityRegistryError::AdminTransferPending);
    }
}

/// Passes before a vault is bound: there is no wind-down to read yet.
pub(crate) fn vault_not_winding_down(e: &Env) {
    if <IdentityRegistry as TimelockHost>::clock(e).is_ok_and(|clock| clock.winding_down) {
        panic_with_error!(e, IdentityRegistryError::WindDownActive);
    }
}

/// Direct changes are instant only before setup finishes.
pub(crate) fn direct_change_allowed(e: &Env) {
    if !setup::is_open(e) {
        panic_with_error!(e, IdentityRegistryError::UseTimelock);
    }
}

/// Only an offer needs setup open; cancelling one (`0`) keeps the admin.
pub(crate) fn direct_hand_over_allowed(e: &Env, live_until_ledger: u32) {
    if live_until_ledger != 0 {
        direct_change_allowed(e);
    }
}

pub(crate) fn verifier_bound(e: &Env) {
    if !governance::has_verifier(e) {
        panic_with_error!(e, IdentityRegistryError::VerifierNotBound);
    }
}

pub(crate) fn operator_is_compliance(e: &Env, operator: &Address) {
    if governance::compliance(e) != *operator {
        panic_with_error!(e, IdentityRegistryError::OperatorNotCompliance);
    }
}

pub(crate) fn not_vetoed(e: &Env, account: &Address) {
    if registry::is_vetoed(e, account) {
        panic_with_error!(e, IdentityRegistryError::Vetoed);
    }
}

pub(crate) fn not_registered(e: &Env, account: &Address) {
    if registry::identity_of(e, account).is_some() {
        panic_with_error!(e, IdentityRegistryError::AlreadyRegistered);
    }
}

pub(crate) fn owns_identity(e: &Env, account: &Address, identity: &Address) {
    if registry::owner_of(e, identity).as_ref() != Some(account) {
        panic_with_error!(e, IdentityRegistryError::NotIdentityOwner);
    }
}

pub(crate) fn no_country_data(e: &Env, country_data_list: &Vec<Val>) {
    if !country_data_list.is_empty() {
        panic_with_error!(e, IdentityRegistryError::CountryDataNotStored);
    }
}

pub(crate) fn same_lengths(
    e: &Env,
    accounts: &Vec<Address>,
    identities: &Vec<Address>,
    country_data_lists: &Vec<Vec<Val>>,
) {
    if accounts.len() != identities.len() || accounts.len() != country_data_lists.len() {
        panic_with_error!(e, IRSError::BatchSizeMismatch);
    }
}
