use soroban_sdk::{
    contract, contractimpl, symbol_short,
    testutils::{Address as _, Events as _, Ledger as _},
    vec, Address, Env, Event as _,
};
use stellar_access::role_transfer::RoleTransferError;
use stellar_tokens::rwa::compliance::ComplianceHook;
use storage::INSTANCE_EXTEND_AMOUNT;
use timelock::{Clock, DAY_DURATION, MIN_DELAY};

use super::{age, instance_ttl};
use crate::{
    ChangeApplied, ChangeProposed, Compliance, ComplianceChange, ComplianceClient,
    ComplianceContractError, CompliancePendingChange, ADMIN_ACCEPT_LEDGERS,
};

/// Plays the vault: reports whatever clock a test sets, and counts the reads.
#[contract]
struct ClockStub;

#[contractimpl]
impl ClockStub {
    pub fn set(e: Env, clock: Clock) {
        e.storage().instance().set(&symbol_short!("clock"), &clock);
    }

    pub fn reads(e: Env) -> u32 {
        e.storage()
            .instance()
            .get(&symbol_short!("reads"))
            .unwrap_or(0)
    }
}

#[contractimpl(contracttrait)]
impl timelock::ClockSource for ClockStub {
    fn timelock_clock(e: &Env) -> Clock {
        let reads = Self::reads(e.clone()) + 1;
        e.storage().instance().set(&symbol_short!("reads"), &reads);
        e.storage().instance().get(&symbol_short!("clock")).unwrap()
    }
}

fn running() -> Clock {
    Clock {
        delay: MIN_DELAY,
        exit_window: 0,
        paused_secs: 0,
        paused: false,
        winding_down: false,
    }
}

struct Fixture<'a> {
    e: Env,
    rules: ComplianceClient<'a>,
    clock: ClockStubClient<'a>,
    admin: Address,
}

impl Fixture<'_> {
    fn propose(&self, change: &ComplianceChange) -> u32 {
        self.rules.propose_change(change, &self.admin)
    }

    fn land(&self, change: &ComplianceChange) {
        let id = self.propose(change);
        self.e.ledger().with_mut(|l| l.timestamp += MIN_DELAY);
        self.rules.apply_change(&id, &self.admin);
    }

    /// Lets the instance decay past its extend threshold, then checks the call
    /// extends it back to the full TTL.
    fn restores_the_instance(&self, call: impl FnOnce()) {
        age(&self.e);
        assert!(instance_ttl(&self.e, &self.rules.address) < INSTANCE_EXTEND_AMOUNT);
        call();
        assert_eq!(
            instance_ttl(&self.e, &self.rules.address),
            INSTANCE_EXTEND_AMOUNT
        );
    }
}

/// A compliance contract in setup, and a vault clock it has not bound yet.
fn unbound<'a>() -> Fixture<'a> {
    let e = Env::default();
    e.mock_all_auths();
    e.ledger().set_timestamp(10_000);
    let admin = Address::generate(&e);
    let rules = ComplianceClient::new(&e, &e.register(Compliance, (admin.clone(),)));
    let clock = ClockStubClient::new(&e, &e.register(ClockStub, ()));
    clock.set(&running());
    Fixture {
        e,
        rules,
        clock,
        admin,
    }
}

/// A compliance contract bound to a vault clock, with setup still open.
fn bound<'a>() -> Fixture<'a> {
    let f = unbound();
    f.rules.bind_vault(&f.clock.address, &f.admin);
    f
}

fn finished<'a>() -> Fixture<'a> {
    let f = bound();
    f.rules.finish_setup(&f.admin);
    f
}

fn refused<T: core::fmt::Debug + PartialEq, E: core::fmt::Debug + PartialEq>(
    result: Result<Result<T, E>, Result<soroban_sdk::Error, soroban_sdk::InvokeError>>,
    expected: ComplianceContractError,
) {
    assert_eq!(result, Err(Ok(expected.into())));
}

#[test]
fn bindings_are_instant_during_setup() {
    let f = bound();
    let token = Address::generate(&f.e);

    f.rules.bind_token(&token, &f.admin);

    assert_eq!(f.rules.linked_tokens(), vec![&f.e, token]);
}

#[test]
fn setup_cannot_finish_without_a_vault() {
    let f = unbound();

    refused(
        f.rules.try_finish_setup(&f.admin),
        ComplianceContractError::VaultNotBound,
    );
    assert!(f.rules.setup_open());
}

#[test]
fn a_second_vault_or_a_late_vault_is_refused() {
    let f = bound();
    refused(
        f.rules.try_bind_vault(&Address::generate(&f.e), &f.admin),
        ComplianceContractError::SetupClosed,
    );

    f.rules.finish_setup(&f.admin);

    refused(
        f.rules.try_bind_vault(&Address::generate(&f.e), &f.admin),
        ComplianceContractError::SetupClosed,
    );
    refused(
        f.rules.try_finish_setup(&f.admin),
        ComplianceContractError::SetupClosed,
    );
    assert_eq!(f.rules.vault(), Some(f.clock.address.clone()));
}

#[test]
fn an_address_that_reports_no_clock_cannot_be_bound() {
    let f = unbound();

    assert!(f
        .rules
        .try_bind_vault(&Address::generate(&f.e), &f.admin)
        .is_err());
    assert_eq!(f.rules.vault(), None);
}

fn implements_the_vault_view<T: bindings::VaultBinding>() {}

#[test]
fn the_contract_answers_the_view_the_vault_reads() {
    implements_the_vault_view::<Compliance>();
    let f = unbound();
    let view = bindings::VaultBindingClient::new(&f.e, &f.rules.address);
    assert_eq!(view.vault(), None);
    assert!(view.setup_open());

    f.rules.bind_vault(&f.clock.address, &f.admin);
    f.rules.finish_setup(&f.admin);

    assert_eq!(view.vault(), Some(f.clock.address.clone()));
    assert!(!view.setup_open());
}

#[test]
fn only_the_admin_binds_and_finishes() {
    let f = unbound();
    let stranger = Address::generate(&f.e);
    f.e.set_auths(&[]);

    assert!(f.rules.try_bind_vault(&f.clock.address, &stranger).is_err());
    assert!(f.rules.try_finish_setup(&stranger).is_err());
    assert_eq!(f.rules.vault(), None);
}

#[test]
fn after_setup_rule_changes_wait_for_the_timelock() {
    let f = finished();
    let token = Address::generate(&f.e);
    let module = Address::generate(&f.e);

    refused(
        f.rules.try_bind_token(&token, &f.admin),
        ComplianceContractError::UseTimelock,
    );
    refused(
        f.rules.try_unbind_token(&token, &f.admin),
        ComplianceContractError::UseTimelock,
    );
    refused(
        f.rules
            .try_add_module_to(&ComplianceHook::CanTransfer, &module, &f.admin),
        ComplianceContractError::UseTimelock,
    );
    refused(
        f.rules
            .try_remove_module_from(&ComplianceHook::CanTransfer, &module, &f.admin),
        ComplianceContractError::UseTimelock,
    );
}

#[test]
fn proposals_wait_until_setup_is_finished() {
    let f = bound();
    refused(
        f.rules.try_propose_change(
            &ComplianceChange::BindToken(Address::generate(&f.e)),
            &f.admin,
        ),
        ComplianceContractError::SetupOpen,
    );
    assert_eq!(f.rules.pending_changes().len(), 0);
}

#[test]
fn a_proposed_binding_lands_after_the_delay() {
    let f = finished();
    let token = Address::generate(&f.e);
    let change = ComplianceChange::BindToken(token.clone());

    let id = f.rules.propose_change(&change, &f.admin);

    assert_eq!(
        f.rules.pending_changes(),
        vec![
            &f.e,
            CompliancePendingChange {
                id,
                change,
                eta: 10_000 + MIN_DELAY,
            }
        ]
    );
    refused(
        f.rules.try_apply_change(&id, &f.admin),
        ComplianceContractError::ChangeNotReady,
    );

    f.e.ledger().set_timestamp(10_000 + MIN_DELAY);
    f.rules.apply_change(&id, &f.admin);

    assert_eq!(f.rules.linked_tokens(), vec![&f.e, token]);
    assert_eq!(f.rules.pending_changes().len(), 0);
}

#[test]
fn every_rule_change_lands_through_the_timelock() {
    let f = bound();
    let token = Address::generate(&f.e);
    let early = Address::generate(&f.e);
    let late = Address::generate(&f.e);
    f.rules.bind_token(&token, &f.admin);
    f.rules
        .add_module_to(&ComplianceHook::CanTransfer, &early, &f.admin);
    f.rules.finish_setup(&f.admin);

    f.land(&ComplianceChange::RemoveModule(
        ComplianceHook::CanTransfer,
        early.clone(),
    ));
    f.land(&ComplianceChange::AddModule(
        ComplianceHook::CanCreate,
        late.clone(),
    ));
    f.land(&ComplianceChange::UnbindToken(token));

    assert!(!f
        .rules
        .is_module_registered(&ComplianceHook::CanTransfer, &early));
    assert!(f
        .rules
        .is_module_registered(&ComplianceHook::CanCreate, &late));
    assert_eq!(f.rules.linked_tokens().len(), 0);
}

#[test]
fn nothing_lands_while_the_vault_is_paused_or_winding_down() {
    let f = finished();
    let module = Address::generate(&f.e);
    let id = f.rules.propose_change(
        &ComplianceChange::AddModule(ComplianceHook::CanCreate, module),
        &f.admin,
    );
    f.e.ledger().set_timestamp(10_000 + MIN_DELAY);

    let mut paused = running();
    paused.paused = true;
    f.clock.set(&paused);
    refused(
        f.rules.try_apply_change(&id, &f.admin),
        ComplianceContractError::VaultPaused,
    );

    let mut winding = running();
    winding.winding_down = true;
    f.clock.set(&winding);
    refused(
        f.rules.try_apply_change(&id, &f.admin),
        ComplianceContractError::WindDownActive,
    );
    refused(
        f.rules.try_propose_change(
            &ComplianceChange::BindToken(Address::generate(&f.e)),
            &f.admin,
        ),
        ComplianceContractError::WindDownActive,
    );
}

#[test]
fn a_vault_pause_pushes_the_change_back() {
    let f = finished();
    let id = f.propose(&ComplianceChange::BindToken(Address::generate(&f.e)));
    let mut resumed = running();
    resumed.paused_secs = 3 * DAY_DURATION;
    f.clock.set(&resumed);
    let eta = 10_000 + MIN_DELAY + 3 * DAY_DURATION;

    assert_eq!(f.rules.pending_changes().get(0).unwrap().eta, eta);
    f.e.ledger().set_timestamp(eta - 1);
    refused(
        f.rules.try_apply_change(&id, &f.admin),
        ComplianceContractError::ChangeNotReady,
    );

    f.e.ledger().set_timestamp(eta);
    f.rules.apply_change(&id, &f.admin);
}

#[test]
fn a_change_shorter_than_a_raised_notice_never_lands() {
    let f = finished();
    let id = f.propose(&ComplianceChange::BindToken(Address::generate(&f.e)));
    let mut raised = running();
    raised.delay = 30 * DAY_DURATION;
    raised.exit_window = 20 * DAY_DURATION;
    f.clock.set(&raised);
    f.e.ledger().set_timestamp(10_000 + 30 * DAY_DURATION);

    refused(
        f.rules.try_apply_change(&id, &f.admin),
        ComplianceContractError::DelayBelowNotice,
    );
}

#[test]
fn a_cancelled_change_never_lands() {
    let f = finished();
    let id = f.rules.propose_change(
        &ComplianceChange::BindToken(Address::generate(&f.e)),
        &f.admin,
    );

    f.rules.cancel_change(&id, &f.admin);

    refused(
        f.rules.try_apply_change(&id, &f.admin),
        ComplianceContractError::ChangeNotFound,
    );
    assert_eq!(f.rules.linked_tokens().len(), 0);
}

#[test]
fn only_the_admin_proposes_cancels_and_applies() {
    let f = finished();
    let stranger = Address::generate(&f.e);
    let change = ComplianceChange::BindToken(Address::generate(&f.e));
    let id = f.propose(&change);
    f.e.ledger().set_timestamp(10_000 + MIN_DELAY);

    f.e.set_auths(&[]);
    assert!(f.rules.try_propose_change(&change, &stranger).is_err());
    assert!(f.rules.try_cancel_change(&id, &stranger).is_err());
    assert!(f.rules.try_apply_change(&id, &stranger).is_err());
    assert_eq!(f.rules.pending_changes().len(), 1);
}

#[test]
fn proposing_and_applying_read_the_vault_clock_once() {
    let f = finished();
    let before = f.clock.reads();

    let id = f.propose(&ComplianceChange::BindToken(Address::generate(&f.e)));
    assert_eq!(f.clock.reads(), before + 1);

    f.e.ledger().set_timestamp(10_000 + MIN_DELAY);
    f.rules.apply_change(&id, &f.admin);
    assert_eq!(f.clock.reads(), before + 2);
}

#[test]
fn proposing_and_applying_publish_the_change() {
    let f = finished();
    let change = ComplianceChange::BindToken(Address::generate(&f.e));

    let id = f.propose(&change);
    assert_eq!(
        f.e.events().all().filter_by_contract(&f.rules.address),
        [ChangeProposed {
            id,
            change: change.clone(),
            eta: 10_000 + MIN_DELAY,
        }
        .to_xdr(&f.e, &f.rules.address)]
    );

    f.e.ledger().set_timestamp(10_000 + MIN_DELAY);
    f.rules.apply_change(&id, &f.admin);
    let events = f.e.events().all().filter_by_contract(&f.rules.address);
    assert_eq!(
        events.events().last(),
        Some(&ChangeApplied { id, change }.to_xdr(&f.e, &f.rules.address))
    );
}

#[test]
fn setup_cannot_finish_while_a_hand_over_is_pending() {
    let f = bound();
    let next = Address::generate(&f.e);
    f.rules
        .transfer_admin_role(&next, &(f.e.ledger().sequence() + 100));

    refused(
        f.rules.try_finish_setup(&f.admin),
        ComplianceContractError::AdminTransferPending,
    );

    f.rules.accept_admin_transfer();
    assert_eq!(f.rules.get_admin(), Some(next.clone()));
    f.rules.finish_setup(&next);
    assert!(!f.rules.setup_open());
}

#[test]
fn a_cancelled_hand_over_no_longer_holds_setup_open() {
    let f = bound();
    let next = Address::generate(&f.e);
    f.rules
        .transfer_admin_role(&next, &(f.e.ledger().sequence() + 100));
    f.rules.transfer_admin_role(&next, &0);

    f.rules.finish_setup(&f.admin);

    assert_eq!(f.rules.get_admin(), Some(f.admin.clone()));
}

#[test]
fn after_setup_the_admin_hands_over_through_the_timelock() {
    let f = finished();
    let next = Address::generate(&f.e);
    refused(
        f.rules
            .try_transfer_admin_role(&next, &(f.e.ledger().sequence() + 100)),
        ComplianceContractError::UseTimelock,
    );

    let id = f
        .rules
        .propose_change(&ComplianceChange::Admin(next.clone()), &f.admin);
    f.e.ledger().set_timestamp(10_000 + MIN_DELAY);
    f.rules.apply_change(&id, &f.admin);
    assert_eq!(f.rules.get_admin(), Some(f.admin.clone()));

    f.rules.accept_admin_transfer();

    assert_eq!(f.rules.get_admin(), Some(next));
}

#[test]
fn a_hand_over_after_setup_is_cancelled_at_once() {
    let f = finished();
    let next = Address::generate(&f.e);
    f.land(&ComplianceChange::Admin(next.clone()));

    f.rules.transfer_admin_role(&next, &0);

    assert!(f.rules.try_accept_admin_transfer().is_err());
    assert_eq!(f.rules.get_admin(), Some(f.admin.clone()));
}

#[test]
fn the_hand_over_offer_is_open_on_its_last_ledger() {
    let f = finished();
    let next = Address::generate(&f.e);
    f.land(&ComplianceChange::Admin(next.clone()));
    let offered_at = f.e.ledger().sequence();

    f.e.ledger()
        .with_mut(|l| l.sequence_number = offered_at + ADMIN_ACCEPT_LEDGERS);
    f.rules.accept_admin_transfer();

    assert_eq!(f.rules.get_admin(), Some(next));
}

#[test]
fn the_hand_over_offer_lasts_seven_days_of_ledgers() {
    let f = finished();
    f.land(&ComplianceChange::Admin(Address::generate(&f.e)));
    let offered_at = f.e.ledger().sequence();

    f.e.ledger()
        .with_mut(|l| l.sequence_number = offered_at + ADMIN_ACCEPT_LEDGERS + 1);

    assert_eq!(
        f.rules.try_accept_admin_transfer(),
        Err(Ok(RoleTransferError::NoPendingTransfer.into()))
    );
    assert_eq!(f.rules.get_admin(), Some(f.admin.clone()));
}

#[test]
fn every_admin_call_restores_the_instance_ttl() {
    let f = unbound();
    let next = Address::generate(&f.e);

    f.restores_the_instance(|| {
        f.rules
            .transfer_admin_role(&next, &(f.e.ledger().sequence() + ADMIN_ACCEPT_LEDGERS))
    });
    f.restores_the_instance(|| f.rules.transfer_admin_role(&next, &0));
    f.restores_the_instance(|| f.rules.bind_vault(&f.clock.address, &f.admin));
    f.restores_the_instance(|| f.rules.finish_setup(&f.admin));

    let change = ComplianceChange::BindToken(Address::generate(&f.e));
    let mut id = 0;
    f.restores_the_instance(|| id = f.propose(&change));
    f.restores_the_instance(|| f.rules.cancel_change(&id, &f.admin));

    let id = f.propose(&ComplianceChange::Admin(next));
    f.e.ledger().with_mut(|l| l.timestamp += MIN_DELAY);
    f.restores_the_instance(|| f.rules.apply_change(&id, &f.admin));
    f.restores_the_instance(|| f.rules.accept_admin_transfer());
}
