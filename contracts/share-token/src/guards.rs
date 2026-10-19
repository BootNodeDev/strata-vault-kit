use soroban_sdk::{panic_with_error, Address, Env, String, Symbol};
use stellar_access::{
    access_control::{self, AccessControlStorageKey},
    role_transfer,
};
use stellar_tokens::rwa::{identity_verification::IdentityVerifierClient, RWA};
use strata_timelock::{queue, setup};

use crate::error::ShareTokenError;
use crate::governance::TokenChange;
use crate::roles::MANAGER_ROLE;
use crate::MAX_REFERENCE_LEN;

pub(crate) fn setup_open(e: &Env) {
    if !setup::is_open(e) {
        panic_with_error!(e, ShareTokenError::SetupClosed);
    }
}

/// No nominee from setup may accept once changes wait, so a hand-over offered
/// during setup holds it open.
pub(crate) fn no_hand_over_pending(e: &Env) {
    if role_transfer::has_active_pending_transfer(e, &AccessControlStorageKey::PendingAdmin) {
        panic_with_error!(e, ShareTokenError::AdminTransferPending);
    }
}

/// Direct admin calls are instant only before setup finishes.
pub(crate) fn direct_change_allowed(e: &Env) {
    if !setup::is_open(e) {
        panic_with_error!(e, ShareTokenError::UseTimelock);
    }
}

/// Taking `manager` away stops every claim, so after setup it waits like a
/// grant. Taking any other role away moves no value and stays instant.
pub(crate) fn direct_revoke_allowed(e: &Env, role: &Symbol) {
    if *role == MANAGER_ROLE {
        direct_change_allowed(e);
    }
}

/// Only an offer needs setup open; cancelling one (`0`) keeps the admin.
pub(crate) fn direct_hand_over_allowed(e: &Env, live_until_ledger: u32) {
    if live_until_ledger != 0 {
        direct_change_allowed(e);
    }
}

/// One upgrade at a time, so a standing eta is never quietly replaced.
pub(crate) fn not_a_second_upgrade(e: &Env, change: &TokenChange) {
    if matches!(change, TokenChange::Upgrade(_)) && upgrade_pending(e) {
        panic_with_error!(e, ShareTokenError::UpgradeAlreadyPending);
    }
}

fn upgrade_pending(e: &Env) -> bool {
    queue::open_ids(e).iter().any(|id| {
        queue::pending::<TokenChange>(e, id)
            .is_some_and(|(change, _)| matches!(change, TokenChange::Upgrade(_)))
    })
}

/// The admin signs too, and is a different account from the caller.
pub(crate) fn admin_co_signs(e: &Env, caller: &Address) {
    let admin = access_control::enforce_admin_auth(e);
    if admin == *caller {
        panic_with_error!(e, ShareTokenError::CoSignRequired);
    }
}

pub(crate) fn valid_reference(e: &Env, reference: &String) {
    if reference.is_empty() || reference.len() > MAX_REFERENCE_LEN {
        panic_with_error!(e, ShareTokenError::InvalidReference);
    }
}

pub(crate) fn not_vault_address(e: &Env, account: &Address) {
    if setup::source(e).as_ref() == Some(account) {
        panic_with_error!(e, ShareTokenError::VaultAddress);
    }
}

/// Unfreezing the vault's address stays possible; freezing it never is.
pub(crate) fn not_freezing_vault(e: &Env, account: &Address, freeze: bool) {
    if freeze {
        not_vault_address(e, account);
    }
}

/// Fails with the identity verifier's own error.
pub(crate) fn identity_verified(e: &Env, account: &Address) {
    IdentityVerifierClient::new(e, &RWA::identity_verifier(e)).verify_identity(account);
}
