//! Each guard passes while its condition holds and refuses with its error once
//! it does not.

use soroban_sdk::{contract, contractimpl, testutils::Address as _, Address, Env, InvokeError};
use strata_timelock::{Clock, MIN_DELAY};

use crate::guards;
use crate::{Compliance, ComplianceClient, ComplianceContractError};

/// Plays the vault: the contract binds only to an address that reports a clock.
#[contract]
struct VaultStub;

#[contractimpl(contracttrait)]
impl strata_timelock::ClockSource for VaultStub {
    fn timelock_clock(_e: &Env) -> Clock {
        Clock {
            delay: MIN_DELAY,
            exit_window: 0,
            paused_secs: 0,
            paused: false,
            winding_down: false,
        }
    }
}

struct Fixture<'a> {
    e: Env,
    rules: ComplianceClient<'a>,
    vault: Address,
}

impl Fixture<'_> {
    fn finish_setup(&self) {
        self.rules.bind_vault(&self.vault);
        self.rules.finish_setup();
    }
}

fn setup<'a>() -> Fixture<'a> {
    let e = Env::default();
    e.mock_all_auths();
    let admin = Address::generate(&e);
    let rules = ComplianceClient::new(&e, &e.register(Compliance, (admin,)));
    let vault = e.register(VaultStub, ());
    Fixture { e, rules, vault }
}

/// Runs `guard` inside the compliance contract, as an entrypoint would.
fn run(f: &Fixture, guard: impl FnOnce()) -> Result<(), Result<soroban_sdk::Error, InvokeError>> {
    f.e.try_as_contract::<(), soroban_sdk::Error>(&f.rules.address, guard)
}

fn holds(f: &Fixture, guard: impl FnOnce()) {
    assert_eq!(run(f, guard), Ok(()));
}

fn refuses(f: &Fixture, error: ComplianceContractError, guard: impl FnOnce()) {
    assert_eq!(run(f, guard), Err(Ok(error.into())));
}

#[test]
fn setup_open_refuses_once_setup_has_finished() {
    let f = setup();
    holds(&f, || guards::setup_open(&f.e));

    f.finish_setup();
    refuses(&f, ComplianceContractError::SetupClosed, || {
        guards::setup_open(&f.e)
    });
}

#[test]
fn no_hand_over_pending_refuses_while_an_offer_is_open() {
    let f = setup();
    holds(&f, || guards::no_hand_over_pending(&f.e));

    let next = Address::generate(&f.e);
    f.rules
        .transfer_admin_role(&next, &(f.e.ledger().sequence() + 100));
    refuses(&f, ComplianceContractError::AdminTransferPending, || {
        guards::no_hand_over_pending(&f.e)
    });

    f.rules.transfer_admin_role(&next, &0);
    holds(&f, || guards::no_hand_over_pending(&f.e));
}

#[test]
fn direct_change_allowed_refuses_after_setup() {
    let f = setup();
    holds(&f, || guards::direct_change_allowed(&f.e));

    f.finish_setup();
    refuses(&f, ComplianceContractError::UseTimelock, || {
        guards::direct_change_allowed(&f.e)
    });
}

#[test]
fn direct_hand_over_allowed_refuses_only_an_offer_after_setup() {
    let f = setup();
    holds(&f, || guards::direct_hand_over_allowed(&f.e, 100));

    f.finish_setup();
    holds(&f, || guards::direct_hand_over_allowed(&f.e, 0));
    refuses(&f, ComplianceContractError::UseTimelock, || {
        guards::direct_hand_over_allowed(&f.e, 100)
    });
}
