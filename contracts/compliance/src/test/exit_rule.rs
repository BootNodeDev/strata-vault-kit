//! Once a vault is bound, no module stops a move into it or a burn; every
//! other move still runs the modules, and a refusal stops it.

use soroban_sdk::{
    contract, contracterror, contractimpl, panic_with_error, symbol_short, testutils::Address as _,
    Address, Env, InvokeError,
};
use stellar_tokens::rwa::compliance::{
    AccountSnapshot, ComplianceError, ComplianceHook, TransferKind,
};
use strata_timelock::{Clock, MIN_DELAY};

use super::snapshot;
use crate::{Compliance, ComplianceClient};

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
enum ModuleError {
    Refused = 1,
}

/// Counts the hook calls it sees and, when built to refuse, refuses each one.
#[contract]
struct Module;

#[contractimpl]
impl Module {
    pub fn __constructor(e: Env, refuses: bool) {
        e.storage()
            .instance()
            .set(&symbol_short!("refuses"), &refuses);
    }

    pub fn calls(e: Env) -> u32 {
        e.storage()
            .instance()
            .get(&symbol_short!("calls"))
            .unwrap_or(0)
    }

    pub fn on_transfer(
        e: Env,
        _from: AccountSnapshot,
        _to: AccountSnapshot,
        _amount: i128,
        _kind: TransferKind,
        _token: Address,
    ) {
        called(&e);
    }

    pub fn on_created(e: Env, _to: AccountSnapshot, _amount: i128, _token: Address) {
        called(&e);
    }

    pub fn on_destroyed(e: Env, _from: AccountSnapshot, _amount: i128, _token: Address) {
        called(&e);
    }
}

fn called(e: &Env) {
    let calls = Module::calls(e.clone()) + 1;
    e.storage().instance().set(&symbol_short!("calls"), &calls);
    if e.storage().instance().get(&symbol_short!("refuses")) == Some(true) {
        panic_with_error!(e, ModuleError::Refused);
    }
}

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
    admin: Address,
    token: Address,
    vault: Address,
    holder: Address,
}

impl<'a> Fixture<'a> {
    /// A new module on all three hooks, after any added before it.
    fn module(&self, refuses: bool) -> ModuleClient<'a> {
        let module = ModuleClient::new(&self.e, &self.e.register(Module, (refuses,)));
        for hook in [
            ComplianceHook::Transferred,
            ComplianceHook::Created,
            ComplianceHook::Destroyed,
        ] {
            self.rules
                .add_module_to(&hook, &module.address, &self.admin);
        }
        module
    }
}

/// Rules with one bound token and a vault they have not bound yet.
fn without_a_vault<'a>() -> Fixture<'a> {
    let e = Env::default();
    e.mock_all_auths();
    let admin = Address::generate(&e);
    let rules = ComplianceClient::new(&e, &e.register(Compliance, (admin.clone(),)));
    let token = Address::generate(&e);
    rules.bind_token(&token, &admin);
    let vault = e.register(VaultStub, ());
    let holder = Address::generate(&e);
    Fixture {
        e,
        rules,
        admin,
        token,
        vault,
        holder,
    }
}

fn setup<'a>() -> Fixture<'a> {
    let f = without_a_vault();
    f.rules.bind_vault(&f.vault);
    f
}

type HookResult =
    Result<Result<(), soroban_sdk::ConversionError>, Result<soroban_sdk::Error, InvokeError>>;

fn refused_by_the_module(result: HookResult) {
    assert_eq!(result, Err(Ok(ModuleError::Refused.into())));
}

fn not_bound(result: HookResult) {
    assert_eq!(result, Err(Ok(ComplianceError::TokenNotBound.into())));
}

#[test]
fn a_refusing_module_does_not_stop_a_move_into_the_vault() {
    let f = setup();
    f.module(true);

    for kind in [
        TransferKind::Standard,
        TransferKind::Delegated(Address::generate(&f.e)),
        TransferKind::Forced,
        TransferKind::Recovery,
    ] {
        f.rules.transferred(
            &snapshot(&f.holder, 10),
            &snapshot(&f.vault, 0),
            &1,
            &kind,
            &f.token,
        );
    }
}

#[test]
fn a_refusing_module_does_not_stop_a_mint_to_the_vault() {
    let f = setup();
    f.module(true);

    f.rules.created(&snapshot(&f.vault, 0), &1, &f.token);
}

#[test]
fn a_refusing_module_does_not_stop_a_burn() {
    let f = setup();
    f.module(true);

    f.rules.destroyed(&snapshot(&f.vault, 10), &1, &f.token);
    f.rules.destroyed(&snapshot(&f.holder, 10), &1, &f.token);
}

#[test]
fn a_refusing_module_still_stops_a_move_to_a_holder() {
    let f = setup();
    f.module(true);
    let other = Address::generate(&f.e);

    refused_by_the_module(f.rules.try_transferred(
        &snapshot(&f.vault, 10),
        &snapshot(&f.holder, 0),
        &1,
        &TransferKind::Forced,
        &f.token,
    ));
    refused_by_the_module(f.rules.try_transferred(
        &snapshot(&f.holder, 10),
        &snapshot(&other, 0),
        &1,
        &TransferKind::Standard,
        &f.token,
    ));
}

#[test]
fn a_refusing_module_still_stops_a_mint_to_a_holder() {
    let f = setup();
    f.module(true);

    refused_by_the_module(f.rules.try_created(&snapshot(&f.holder, 0), &1, &f.token));
}

/// The refusing module comes first, so the counting one is still reached, and
/// the refusing one keeps none of its own changes.
#[test]
fn a_counting_module_sees_moves_into_the_vault() {
    let f = setup();
    let refusing = f.module(true);
    let counting = f.module(false);

    f.rules.transferred(
        &snapshot(&f.holder, 10),
        &snapshot(&f.vault, 0),
        &1,
        &TransferKind::Forced,
        &f.token,
    );

    assert_eq!(counting.calls(), 1);
    assert_eq!(refusing.calls(), 0);
}

#[test]
fn a_counting_module_sees_mints_to_the_vault_and_burns() {
    let f = setup();
    f.module(true);
    let counting = f.module(false);

    f.rules.created(&snapshot(&f.vault, 0), &1, &f.token);
    f.rules.destroyed(&snapshot(&f.holder, 10), &1, &f.token);

    assert_eq!(counting.calls(), 2);
}

#[test]
fn an_unbound_token_is_still_refused_on_every_hook() {
    let f = setup();
    f.module(false);
    let stranger = Address::generate(&f.e);

    not_bound(f.rules.try_transferred(
        &snapshot(&f.holder, 10),
        &snapshot(&f.vault, 0),
        &1,
        &TransferKind::Forced,
        &stranger,
    ));
    not_bound(f.rules.try_transferred(
        &snapshot(&f.vault, 10),
        &snapshot(&f.holder, 0),
        &1,
        &TransferKind::Forced,
        &stranger,
    ));
    not_bound(f.rules.try_created(&snapshot(&f.vault, 0), &1, &stranger));
    not_bound(f.rules.try_created(&snapshot(&f.holder, 0), &1, &stranger));
    not_bound(
        f.rules
            .try_destroyed(&snapshot(&f.holder, 10), &1, &stranger),
    );
}

#[test]
fn a_refusing_module_stops_every_move_before_a_vault_is_bound() {
    let f = without_a_vault();
    f.module(true);

    refused_by_the_module(f.rules.try_transferred(
        &snapshot(&f.holder, 10),
        &snapshot(&f.vault, 0),
        &1,
        &TransferKind::Forced,
        &f.token,
    ));
    refused_by_the_module(f.rules.try_created(&snapshot(&f.vault, 0), &1, &f.token));
    refused_by_the_module(
        f.rules
            .try_destroyed(&snapshot(&f.holder, 10), &1, &f.token),
    );
}
