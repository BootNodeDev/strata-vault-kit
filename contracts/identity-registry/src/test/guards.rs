//! Each guard passes while its condition holds and refuses with its error once
//! it does not.

use soroban_sdk::{testutils::Address as _, vec, Address, IntoVal, InvokeError, Val, Vec};
use stellar_tokens::rwa::identity_verification::identity_registry_storage::IRSError;

use super::{bound, deploy, unbound, Fixture};
use crate::guards;
use crate::IdentityRegistryError;

/// Runs `guard` inside the registry, as an entrypoint would.
fn run(f: &Fixture, guard: impl FnOnce()) -> Result<(), Result<soroban_sdk::Error, InvokeError>> {
    f.e.try_as_contract::<(), soroban_sdk::Error>(&f.registry.address, guard)
}

fn holds(f: &Fixture, guard: impl FnOnce()) {
    assert_eq!(run(f, guard), Ok(()));
}

fn refuses(f: &Fixture, error: impl Into<soroban_sdk::Error>, guard: impl FnOnce()) {
    assert_eq!(run(f, guard), Err(Ok(error.into())));
}

#[test]
fn setup_open_refuses_once_setup_has_finished() {
    let f = bound();
    holds(&f, || guards::setup_open(&f.e));

    f.registry.finish_setup();
    refuses(&f, IdentityRegistryError::SetupClosed, || {
        guards::setup_open(&f.e)
    });
}

#[test]
fn no_hand_over_pending_refuses_while_an_offer_is_open() {
    let f = bound();
    holds(&f, || guards::no_hand_over_pending(&f.e));

    let next = Address::generate(&f.e);
    f.registry
        .transfer_admin_role(&next, &(f.e.ledger().sequence() + 100));
    refuses(&f, IdentityRegistryError::AdminTransferPending, || {
        guards::no_hand_over_pending(&f.e)
    });

    f.registry.transfer_admin_role(&next, &0);
    holds(&f, || guards::no_hand_over_pending(&f.e));
}

#[test]
fn vault_not_winding_down_refuses_during_a_wind_down() {
    let f = bound();
    holds(&f, || guards::vault_not_winding_down(&f.e));

    f.wind_down();
    refuses(&f, IdentityRegistryError::WindDownActive, || {
        guards::vault_not_winding_down(&f.e)
    });
}

#[test]
fn direct_change_allowed_refuses_after_setup() {
    let f = bound();
    holds(&f, || guards::direct_change_allowed(&f.e));

    f.registry.finish_setup();
    refuses(&f, IdentityRegistryError::UseTimelock, || {
        guards::direct_change_allowed(&f.e)
    });
}

#[test]
fn direct_hand_over_allowed_refuses_only_an_offer_after_setup() {
    let f = bound();
    holds(&f, || guards::direct_hand_over_allowed(&f.e, 100));

    f.registry.finish_setup();
    holds(&f, || guards::direct_hand_over_allowed(&f.e, 0));
    refuses(&f, IdentityRegistryError::UseTimelock, || {
        guards::direct_hand_over_allowed(&f.e, 100)
    });
}

#[test]
fn verifier_bound_refuses_until_a_verifier_is_bound() {
    let f = unbound();
    refuses(&f, IdentityRegistryError::VerifierNotBound, || {
        guards::verifier_bound(&f.e)
    });

    f.registry.bind_verifier(&f.verifier.address);
    holds(&f, || guards::verifier_bound(&f.e));
}

#[test]
fn operator_is_compliance_refuses_anyone_else() {
    let f = bound();
    holds(&f, || guards::operator_is_compliance(&f.e, &f.compliance));

    for other in [Address::generate(&f.e), f.admin.clone()] {
        refuses(&f, IdentityRegistryError::OperatorNotCompliance, || {
            guards::operator_is_compliance(&f.e, &other)
        });
    }
}

#[test]
fn not_vetoed_refuses_a_vetoed_wallet() {
    let f = bound();
    let account = Address::generate(&f.e);
    holds(&f, || guards::not_vetoed(&f.e, &account));

    f.registry.remove_identity(&account, &f.compliance);
    refuses(&f, IdentityRegistryError::Vetoed, || {
        guards::not_vetoed(&f.e, &account)
    });
}

#[test]
fn not_registered_refuses_a_linked_wallet() {
    let f = bound();
    let account = Address::generate(&f.e);
    holds(&f, || guards::not_registered(&f.e, &account));

    let (linked, _) = f.onboarded();
    refuses(&f, IdentityRegistryError::AlreadyRegistered, || {
        guards::not_registered(&f.e, &linked)
    });
}

#[test]
fn owns_identity_refuses_another_owner() {
    let f = bound();
    let account = Address::generate(&f.e);
    let own = deploy(&f.e, &f.identity_wasm, &account);
    let other = deploy(&f.e, &f.identity_wasm, &Address::generate(&f.e));
    holds(&f, || guards::owns_identity(&f.e, &account, &own));

    refuses(&f, IdentityRegistryError::NotIdentityOwner, || {
        guards::owns_identity(&f.e, &account, &other)
    });
}

#[test]
fn no_country_data_refuses_any_entry() {
    let f = bound();
    holds(&f, || guards::no_country_data(&f.e, &Vec::new(&f.e)));

    let some: Vec<Val> = vec![&f.e, 840u32.into_val(&f.e)];
    refuses(&f, IdentityRegistryError::CountryDataNotStored, || {
        guards::no_country_data(&f.e, &some)
    });
}

#[test]
fn same_lengths_refuses_lists_that_differ() {
    let f = bound();
    let account = Address::generate(&f.e);
    let identity = Address::generate(&f.e);
    let none: Vec<Val> = Vec::new(&f.e);
    let accounts = vec![&f.e, account.clone()];
    let identities = vec![&f.e, identity.clone()];
    let lists = vec![&f.e, none.clone()];
    holds(&f, || {
        guards::same_lengths(&f.e, &accounts, &identities, &lists)
    });

    let two_accounts = vec![&f.e, account.clone(), account];
    let two_identities = vec![&f.e, identity.clone(), identity];
    let two_lists = vec![&f.e, none.clone(), none];
    refuses(&f, IRSError::BatchSizeMismatch, || {
        guards::same_lengths(&f.e, &two_accounts, &identities, &lists)
    });
    refuses(&f, IRSError::BatchSizeMismatch, || {
        guards::same_lengths(&f.e, &accounts, &two_identities, &lists)
    });
    refuses(&f, IRSError::BatchSizeMismatch, || {
        guards::same_lengths(&f.e, &accounts, &identities, &two_lists)
    });
}
