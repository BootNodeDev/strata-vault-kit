//! Each guard passes while its condition holds and refuses with its error once
//! it does not.

use soroban_sdk::{testutils::Address as _, Address, InvokeError};

use super::{bound, unbound, Fixture};
use crate::guards;
use crate::VerifierError;

/// Runs `guard` inside the verifier, as an entrypoint would.
fn run(f: &Fixture, guard: impl FnOnce()) -> Result<(), Result<soroban_sdk::Error, InvokeError>> {
    f.e.try_as_contract::<(), soroban_sdk::Error>(&f.verifier.address, guard)
}

fn holds(f: &Fixture, guard: impl FnOnce()) {
    assert_eq!(run(f, guard), Ok(()));
}

fn refuses(f: &Fixture, error: VerifierError, guard: impl FnOnce()) {
    assert_eq!(run(f, guard), Err(Ok(error.into())));
}

#[test]
fn setup_open_refuses_once_setup_has_finished() {
    let f = bound();
    holds(&f, || guards::setup_open(&f.e));

    f.verifier.finish_setup();
    refuses(&f, VerifierError::SetupClosed, || guards::setup_open(&f.e));
}

#[test]
fn no_hand_over_pending_refuses_while_an_offer_is_open() {
    let f = bound();
    holds(&f, || guards::no_hand_over_pending(&f.e));

    let next = Address::generate(&f.e);
    f.verifier
        .transfer_admin_role(&next, &(f.e.ledger().sequence() + 100));
    refuses(&f, VerifierError::AdminTransferPending, || {
        guards::no_hand_over_pending(&f.e)
    });

    f.verifier.transfer_admin_role(&next, &0);
    holds(&f, || guards::no_hand_over_pending(&f.e));
}

#[test]
fn vault_not_winding_down_refuses_during_a_wind_down() {
    let f = bound();
    holds(&f, || guards::vault_not_winding_down(&f.e));

    f.wind_down();
    refuses(&f, VerifierError::WindDownActive, || {
        guards::vault_not_winding_down(&f.e)
    });
}

#[test]
fn direct_change_allowed_refuses_after_setup() {
    let f = bound();
    holds(&f, || guards::direct_change_allowed(&f.e));

    f.verifier.finish_setup();
    refuses(&f, VerifierError::UseTimelock, || {
        guards::direct_change_allowed(&f.e)
    });
}

#[test]
fn direct_hand_over_allowed_refuses_only_an_offer_after_setup() {
    let f = bound();
    holds(&f, || guards::direct_hand_over_allowed(&f.e, 100));

    f.verifier.finish_setup();
    holds(&f, || guards::direct_hand_over_allowed(&f.e, 0));
    refuses(&f, VerifierError::UseTimelock, || {
        guards::direct_hand_over_allowed(&f.e, 100)
    });
}

#[test]
fn operator_is_admin_refuses_anyone_else() {
    let f = bound();
    holds(&f, || guards::operator_is_admin(&f.e, &f.admin));

    refuses(&f, VerifierError::OperatorNotAdmin, || {
        guards::operator_is_admin(&f.e, &Address::generate(&f.e))
    });
}

#[test]
fn not_the_vault_refuses_only_the_bound_vault() {
    let f = unbound();
    holds(&f, || guards::not_the_vault(&f.e, &f.clock.address));

    f.verifier.bind_vault(&f.clock.address);
    refuses(&f, VerifierError::VaultIsProtocol, || {
        guards::not_the_vault(&f.e, &f.clock.address)
    });
    holds(&f, || guards::not_the_vault(&f.e, &Address::generate(&f.e)));
}
