use soroban_sdk::{panic_with_error, Address, Env, String, Symbol};
use stellar_access::{
    access_control::{self, AccessControlStorageKey},
    role_transfer,
};
use stellar_tokens::rwa::{
    identity_verification::IdentityVerifierClient, utils::token_binder::TokenBinderClient, RWA,
};
use strata_bindings::VaultBindingClient;
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

/// What a change must meet when it is proposed and again when it applies:
/// rules bound here, or a verifier that accepts the vault.
pub(crate) fn valid_change(e: &Env, change: &TokenChange) {
    match change {
        TokenChange::Compliance(rules) => compliance_bound_here(e, rules),
        TokenChange::IdentityVerifier(verifier) => verifier_accepts_vault(e, verifier),
        TokenChange::Upgrade(_)
        | TokenChange::GrantRole(..)
        | TokenChange::RevokeRole(..)
        | TokenChange::Admin(_) => {}
    }
}

/// Rules that leave out this token stop every mint, transfer and burn; rules
/// off the vault's clock could change with no delay.
pub(crate) fn compliance_bound_here(e: &Env, rules: &Address) {
    if !on_the_vaults_clock(e, rules) || !lists_this_token(e, rules) {
        panic_with_error!(e, ShareTokenError::ComplianceNotBound);
    }
}

pub(crate) fn verifier_accepts_vault(e: &Env, verifier: &Address) {
    let accepted = setup::source(e).is_some_and(|vault| {
        matches!(
            IdentityVerifierClient::new(e, verifier).try_verify_identity(&vault),
            Ok(Ok(()))
        )
    });
    if !accepted {
        panic_with_error!(e, ShareTokenError::VerifierRefusesVault);
    }
}

/// `contract` names this token's vault and its own setup has finished.
fn on_the_vaults_clock(e: &Env, contract: &Address) -> bool {
    let binding = VaultBindingClient::new(e, contract);
    setup::source(e)
        .is_some_and(|vault| matches!(binding.try_vault(), Ok(Ok(Some(named))) if named == vault))
        && matches!(binding.try_setup_open(), Ok(Ok(false)))
}

fn lists_this_token(e: &Env, rules: &Address) -> bool {
    matches!(
        TokenBinderClient::new(e, rules).try_linked_tokens(),
        Ok(Ok(linked)) if linked.contains(e.current_contract_address())
    )
}

/// Stands in for `#[only_admin]` where an OpenZeppelin trait fixes the caller.
pub(crate) fn caller_is_admin(e: &Env, caller: &Address) {
    if access_control::get_admin(e).as_ref() != Some(caller) {
        panic_with_error!(e, ShareTokenError::AdminRequired);
    }
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
