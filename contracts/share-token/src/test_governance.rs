use soroban_sdk::{
    contract, contractimpl, symbol_short,
    testutils::{
        storage::Instance as _, Address as _, Events as _, Ledger as _, MockAuth, MockAuthInvoke,
    },
    Address, BytesN, Env, Event as _, IntoVal, String, Symbol,
};
use storage::INSTANCE_EXTEND_AMOUNT;
use timelock::{Clock, DAY_DURATION, MIN_DELAY};

use crate::{
    ChangeApplied, ChangeProposed, ShareToken, ShareTokenClient, ShareTokenError, TokenChange,
    ADMIN_ACCEPT_LEDGERS,
};

const TWO_DAYS_IN_LEDGERS: u32 = 2 * 17_280;

/// Plays the vault: reports whatever clock a test sets.
#[contract]
struct ClockStub;

#[contractimpl]
impl ClockStub {
    pub fn set(e: Env, clock: Clock) {
        e.storage().instance().set(&symbol_short!("clock"), &clock);
    }
}

#[contractimpl(contracttrait)]
impl timelock::ClockSource for ClockStub {
    fn timelock_clock(e: &Env) -> Clock {
        e.storage().instance().get(&symbol_short!("clock")).unwrap()
    }
}

struct Fixture<'a> {
    e: Env,
    token: ShareTokenClient<'a>,
    vault: ClockStubClient<'a>,
    admin: Address,
}

impl Fixture<'_> {
    fn clock(&self, f: impl FnOnce(&mut Clock)) {
        let mut clock =
            timelock::ClockSourceClient::new(&self.e, &self.vault.address).timelock_clock();
        f(&mut clock);
        self.vault.set(&clock);
    }

    fn advance(&self, secs: u64) {
        self.e.ledger().with_mut(|l| {
            l.timestamp += secs;
            l.sequence_number += (secs / 5).max(1) as u32;
        });
    }

    fn finish(&self) {
        self.token.bind_vault(&self.vault.address, &self.admin);
        self.token.finish_setup(&self.admin);
    }

    fn propose(&self, change: TokenChange) -> u32 {
        self.token.propose_change(&change, &self.admin)
    }

    fn instance_ttl(&self) -> u32 {
        self.e.as_contract(&self.token.address, || {
            self.e.storage().instance().get_ttl()
        })
    }

    /// Lets the instance decay past its extend threshold, then checks the call
    /// extends it back to the full TTL.
    fn restores_the_instance(&self, call: impl FnOnce()) {
        self.e
            .ledger()
            .with_mut(|l| l.sequence_number += TWO_DAYS_IN_LEDGERS);
        assert!(self.instance_ttl() < INSTANCE_EXTEND_AMOUNT);
        call();
        assert_eq!(self.instance_ttl(), INSTANCE_EXTEND_AMOUNT);
    }
}

fn setup<'a>() -> Fixture<'a> {
    let e = Env::default();
    e.mock_all_auths();
    e.ledger().set_timestamp(10_000);
    let admin = Address::generate(&e);
    let token = e.register(
        ShareToken,
        (
            String::from_str(&e, "Strata Vault USDC"),
            String::from_str(&e, "bvUSDC"),
            admin.clone(),
            Address::generate(&e),
            Address::generate(&e),
            Address::generate(&e),
        ),
    );
    let vault = ClockStubClient::new(&e, &e.register(ClockStub, ()));
    vault.set(&Clock {
        delay: MIN_DELAY,
        exit_window: 0,
        paused_secs: 0,
        paused: false,
        winding_down: false,
    });
    Fixture {
        token: ShareTokenClient::new(&e, &token),
        vault,
        admin,
        e,
    }
}

fn refused<T: core::fmt::Debug + PartialEq, E: core::fmt::Debug + PartialEq>(
    result: Result<Result<T, E>, Result<soroban_sdk::Error, soroban_sdk::InvokeError>>,
    expected: ShareTokenError,
) {
    assert_eq!(result, Err(Ok(expected.into())));
}

fn manager() -> Symbol {
    symbol_short!("manager")
}

fn compliance(e: &Env) -> Symbol {
    Symbol::new(e, "compliance")
}

#[test]
fn setup_is_open_until_finished_and_never_reopens() {
    let f = setup();
    assert!(f.token.setup_open());
    refused(
        f.token.try_finish_setup(&f.admin),
        ShareTokenError::VaultNotBound,
    );

    f.finish();

    assert!(!f.token.setup_open());
    assert_eq!(f.token.vault(), Some(f.vault.address.clone()));
    refused(
        f.token.try_finish_setup(&f.admin),
        ShareTokenError::SetupClosed,
    );
    refused(
        f.token.try_bind_vault(&Address::generate(&f.e), &f.admin),
        ShareTokenError::SetupClosed,
    );
}

#[test]
fn a_second_vault_cannot_be_bound() {
    let f = setup();
    f.token.bind_vault(&f.vault.address, &f.admin);

    refused(
        f.token.try_bind_vault(&Address::generate(&f.e), &f.admin),
        ShareTokenError::SetupClosed,
    );
    assert_eq!(f.token.vault(), Some(f.vault.address.clone()));
}

#[test]
fn an_address_that_reports_no_clock_cannot_be_bound() {
    let f = setup();

    assert!(f
        .token
        .try_bind_vault(&Address::generate(&f.e), &f.admin)
        .is_err());
    assert_eq!(f.token.vault(), None);
}

#[test]
fn only_the_admin_binds_and_finishes() {
    let f = setup();
    let stranger = Address::generate(&f.e);
    f.e.set_auths(&[]);

    assert!(f.token.try_bind_vault(&f.vault.address, &stranger).is_err());
    assert!(f.token.try_finish_setup(&stranger).is_err());
    assert!(f.token.setup_open());
}

fn implements_the_vault_view<T: bindings::VaultBound>() {}

#[test]
fn the_token_answers_the_view_the_vault_reads() {
    implements_the_vault_view::<ShareToken>();
    let f = setup();
    let view = bindings::VaultBoundClient::new(&f.e, &f.token.address);
    assert_eq!(view.vault(), None);
    assert!(view.setup_open());

    f.finish();

    assert_eq!(view.vault(), Some(f.vault.address.clone()));
    assert!(!view.setup_open());
}

#[test]
fn grants_and_manager_revokes_wait_after_setup() {
    let f = setup();
    let early = Address::generate(&f.e);
    f.token.grant_role(&early, &manager(), &f.admin);
    assert!(f.token.has_role(&early, &manager()).is_some());

    f.finish();

    refused(
        f.token
            .try_grant_role(&Address::generate(&f.e), &manager(), &f.admin),
        ShareTokenError::UseTimelock,
    );
    refused(
        f.token.try_revoke_role(&early, &manager(), &f.admin),
        ShareTokenError::UseTimelock,
    );
    assert!(f.token.has_role(&early, &manager()).is_some());
}

#[test]
fn rule_and_verifier_swaps_wait_after_setup() {
    let f = setup();
    f.finish();

    refused(
        f.token
            .try_set_compliance(&Address::generate(&f.e), &f.admin),
        ShareTokenError::UseTimelock,
    );
    refused(
        f.token
            .try_set_identity_verifier(&Address::generate(&f.e), &f.admin),
        ShareTokenError::UseTimelock,
    );
}

#[test]
fn revoking_compliance_stays_instant_after_setup() {
    let f = setup();
    let officer = Address::generate(&f.e);
    f.token.grant_role(&officer, &compliance(&f.e), &f.admin);
    f.finish();

    f.token.revoke_role(&officer, &compliance(&f.e), &f.admin);

    assert!(f.token.has_role(&officer, &compliance(&f.e)).is_none());
}

#[test]
fn an_admin_hand_over_waits_but_cancelling_one_does_not() {
    let f = setup();
    f.finish();
    let next = Address::generate(&f.e);

    refused(
        f.token
            .try_transfer_admin_role(&next, &(f.e.ledger().sequence() + 100)),
        ShareTokenError::UseTimelock,
    );

    let id = f.propose(TokenChange::Admin(next.clone()));
    f.advance(MIN_DELAY);
    f.token.apply_change(&id, &f.admin);
    f.token.transfer_admin_role(&next, &0);

    assert!(f.token.try_accept_admin_transfer().is_err());
    assert_eq!(f.token.get_admin(), Some(f.admin.clone()));
}

#[test]
fn setup_cannot_finish_while_a_hand_over_is_pending() {
    let f = setup();
    let next = Address::generate(&f.e);
    f.token.bind_vault(&f.vault.address, &f.admin);
    f.token
        .transfer_admin_role(&next, &(f.e.ledger().sequence() + 100));

    refused(
        f.token.try_finish_setup(&f.admin),
        ShareTokenError::AdminTransferPending,
    );

    f.token.transfer_admin_role(&next, &0);
    f.token.finish_setup(&f.admin);
    assert!(f.token.try_accept_admin_transfer().is_err());
    assert_eq!(f.token.get_admin(), Some(f.admin.clone()));
}

#[test]
fn an_expired_hand_over_does_not_hold_setup_open() {
    let f = setup();
    f.token.bind_vault(&f.vault.address, &f.admin);
    f.token
        .transfer_admin_role(&Address::generate(&f.e), &(f.e.ledger().sequence() + 10));
    f.e.ledger().with_mut(|l| l.sequence_number += 11);

    f.token.finish_setup(&f.admin);

    assert!(!f.token.setup_open());
}

#[test]
fn the_token_exposes_no_immediate_upgrade() {
    let f = setup();
    f.finish();
    let upgrader =
        stellar_contract_utils::upgradeable::UpgradeableClient::new(&f.e, &f.token.address);

    assert!(upgrader
        .try_upgrade(&BytesN::from_array(&f.e, &[7; 32]), &f.admin)
        .is_err());
    assert_eq!(f.token.schema_version(), 1);
}

#[test]
fn no_role_ever_gets_a_role_admin() {
    let f = setup();

    refused(
        f.token
            .try_set_role_admin(&manager(), &symbol_short!("guardian")),
        ShareTokenError::UseTimelock,
    );
}

#[test]
fn nothing_is_proposed_during_setup() {
    let f = setup();

    refused(
        f.token.try_propose_change(
            &TokenChange::GrantRole(manager(), f.admin.clone()),
            &f.admin,
        ),
        ShareTokenError::SetupOpen,
    );
    assert_eq!(f.token.pending_changes().len(), 0);
}

#[test]
fn a_grant_lands_one_vault_delay_after_it_was_proposed() {
    let f = setup();
    f.finish();
    let next = Address::generate(&f.e);

    let id = f.propose(TokenChange::GrantRole(manager(), next.clone()));
    let pending = f.token.pending_changes();
    assert_eq!(pending.len(), 1);
    assert_eq!(
        pending.get(0).unwrap().eta,
        f.e.ledger().timestamp() + MIN_DELAY
    );

    f.advance(MIN_DELAY - 1);
    refused(
        f.token.try_apply_change(&id, &f.admin),
        ShareTokenError::ChangeNotReady,
    );

    f.advance(1);
    f.token.apply_change(&id, &f.admin);
    assert!(f.token.has_role(&next, &manager()).is_some());
    assert_eq!(f.token.pending_changes().len(), 0);
}

#[test]
fn a_revoke_lands_through_the_timelock() {
    let f = setup();
    let holder = Address::generate(&f.e);
    f.token.grant_role(&holder, &manager(), &f.admin);
    f.finish();

    let id = f.propose(TokenChange::RevokeRole(manager(), holder.clone()));
    f.advance(MIN_DELAY);
    f.token.apply_change(&id, &f.admin);

    assert!(f.token.has_role(&holder, &manager()).is_none());
}

#[test]
fn a_vault_pause_moves_the_eta_and_holds_the_change() {
    let f = setup();
    f.finish();
    let id = f.propose(TokenChange::Compliance(Address::generate(&f.e)));
    let eta = f.token.pending_changes().get(0).unwrap().eta;

    f.advance(DAY_DURATION);
    f.clock(|c| c.paused = true);
    f.advance(3 * DAY_DURATION);
    f.clock(|c| c.paused_secs = 3 * DAY_DURATION);
    f.advance(MIN_DELAY);

    refused(
        f.token.try_apply_change(&id, &f.admin),
        ShareTokenError::VaultPaused,
    );

    f.clock(|c| c.paused = false);
    assert_eq!(
        f.token.pending_changes().get(0).unwrap().eta,
        eta + 3 * DAY_DURATION
    );
    f.advance(3 * DAY_DURATION);
    f.token.apply_change(&id, &f.admin);
}

#[test]
fn nothing_is_proposed_or_applied_while_the_vault_winds_down() {
    let f = setup();
    f.finish();
    let id = f.propose(TokenChange::Compliance(Address::generate(&f.e)));
    f.clock(|c| c.winding_down = true);
    f.advance(MIN_DELAY);

    refused(
        f.token
            .try_propose_change(&TokenChange::Compliance(Address::generate(&f.e)), &f.admin),
        ShareTokenError::WindDownActive,
    );
    refused(
        f.token.try_apply_change(&id, &f.admin),
        ShareTokenError::WindDownActive,
    );
    f.token.cancel_change(&id, &f.admin);
}

#[test]
fn a_change_shorter_than_a_raised_notice_never_lands() {
    let f = setup();
    f.finish();
    let id = f.propose(TokenChange::Compliance(Address::generate(&f.e)));
    f.clock(|c| {
        c.delay = 30 * DAY_DURATION;
        c.exit_window = 20 * DAY_DURATION;
    });
    f.advance(30 * DAY_DURATION);

    refused(
        f.token.try_apply_change(&id, &f.admin),
        ShareTokenError::DelayBelowNotice,
    );
}

#[test]
fn one_upgrade_waits_at_a_time() {
    let f = setup();
    f.finish();
    f.propose(TokenChange::Upgrade(BytesN::from_array(&f.e, &[7; 32])));

    refused(
        f.token.try_propose_change(
            &TokenChange::Upgrade(BytesN::from_array(&f.e, &[9; 32])),
            &f.admin,
        ),
        ShareTokenError::UpgradeAlreadyPending,
    );
}

#[test]
fn only_the_admin_proposes_cancels_and_applies() {
    let f = setup();
    f.finish();
    let stranger = Address::generate(&f.e);
    let change = TokenChange::Compliance(Address::generate(&f.e));
    let id = f.propose(change.clone());
    f.advance(MIN_DELAY);

    f.e.set_auths(&[]);
    assert!(f.token.try_propose_change(&change, &stranger).is_err());
    assert!(f.token.try_cancel_change(&id, &stranger).is_err());
    assert!(f.token.try_apply_change(&id, &stranger).is_err());
    assert_eq!(f.token.pending_changes().len(), 1);
}

#[test]
fn an_applied_admin_change_starts_a_hand_over_the_next_admin_accepts() {
    let f = setup();
    f.finish();
    let next = Address::generate(&f.e);
    let id = f.propose(TokenChange::Admin(next.clone()));
    f.advance(MIN_DELAY);

    // The admin authorises this call and nothing else: the hand-over inside it
    // asks for no further signature. The entrypoint checks the admin and the
    // caller, so the same authorisation appears twice, as simulation records it.
    let apply = MockAuthInvoke {
        contract: &f.token.address,
        fn_name: "apply_change",
        args: (id, f.admin.clone()).into_val(&f.e),
        sub_invokes: &[],
    };
    f.e.mock_auths(&[
        MockAuth {
            address: &f.admin,
            invoke: &apply,
        },
        MockAuth {
            address: &f.admin,
            invoke: &apply,
        },
    ]);
    f.token.apply_change(&id, &f.admin);

    f.e.mock_all_auths();
    assert_eq!(f.token.get_admin(), Some(f.admin.clone()));
    f.token.accept_admin_transfer();
    assert_eq!(f.token.get_admin(), Some(next));
}

#[test]
fn the_hand_over_offer_lasts_seven_days_of_ledgers() {
    let f = setup();
    f.finish();
    let next = Address::generate(&f.e);
    let id = f.propose(TokenChange::Admin(next));
    f.advance(MIN_DELAY);
    f.token.apply_change(&id, &f.admin);

    f.e.ledger()
        .with_mut(|l| l.sequence_number += ADMIN_ACCEPT_LEDGERS + 1);

    assert!(f.token.try_accept_admin_transfer().is_err());
}

#[test]
fn applied_rule_and_verifier_changes_take_effect() {
    let f = setup();
    f.finish();
    let rules = Address::generate(&f.e);
    let verifier = Address::generate(&f.e);
    let first = f.propose(TokenChange::Compliance(rules.clone()));
    let second = f.propose(TokenChange::IdentityVerifier(verifier.clone()));
    f.advance(MIN_DELAY);

    f.token.apply_change(&first, &f.admin);
    f.token.apply_change(&second, &f.admin);

    assert_eq!(f.token.compliance(), rules);
    assert_eq!(f.token.identity_verifier(), verifier);
}

#[test]
fn proposing_and_applying_publish_the_change() {
    let f = setup();
    f.finish();
    let change = TokenChange::Compliance(Address::generate(&f.e));
    let eta = f.e.ledger().timestamp() + MIN_DELAY;

    let id = f.propose(change.clone());
    assert_eq!(
        f.e.events().all().filter_by_contract(&f.token.address),
        [ChangeProposed {
            id,
            change: change.clone(),
            eta,
        }
        .to_xdr(&f.e, &f.token.address)]
    );

    f.advance(MIN_DELAY);
    f.token.apply_change(&id, &f.admin);
    let events = f.e.events().all().filter_by_contract(&f.token.address);
    assert_eq!(
        events.events().last(),
        Some(&ChangeApplied { id, change }.to_xdr(&f.e, &f.token.address))
    );
}

#[test]
fn the_schema_version_is_one_after_construction() {
    let f = setup();

    assert_eq!(f.token.schema_version(), 1);
}

#[test]
fn every_admin_call_restores_the_instance_ttl() {
    let f = setup();
    let holder = Address::generate(&f.e);
    let next = Address::generate(&f.e);

    f.restores_the_instance(|| f.token.grant_role(&holder, &manager(), &f.admin));
    f.restores_the_instance(|| f.token.revoke_role(&holder, &manager(), &f.admin));
    f.restores_the_instance(|| {
        f.token
            .transfer_admin_role(&next, &(f.e.ledger().sequence() + ADMIN_ACCEPT_LEDGERS))
    });
    f.restores_the_instance(|| f.token.transfer_admin_role(&next, &0));
    f.restores_the_instance(|| f.token.bind_vault(&f.vault.address, &f.admin));
    f.restores_the_instance(|| f.token.finish_setup(&f.admin));

    let rules = TokenChange::Compliance(Address::generate(&f.e));
    let mut id = 0;
    f.restores_the_instance(|| id = f.propose(rules.clone()));
    f.restores_the_instance(|| f.token.cancel_change(&id, &f.admin));

    let id = f.propose(rules);
    f.advance(MIN_DELAY);
    f.restores_the_instance(|| f.token.apply_change(&id, &f.admin));
}
