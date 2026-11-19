extern crate std;

use investor_identity::InvestorIdentity;
use soroban_sdk::{
    testutils::{
        Address as _, AuthorizedFunction, AuthorizedInvocation, Events as _, Ledger as _, MockAuth,
        MockAuthInvoke,
    },
    vec, Address, Event as _, Executable, IntoVal, Symbol, Val, Vec,
};
use stellar_access::role_transfer::RoleTransferError;
use strata_timelock::{DAY_DURATION, MIN_DELAY};

use super::{
    bound, finished, missing_auth, refused, running, unbound, Fixture, VerifierDouble,
    VerifierDoubleClient, NOW,
};
use crate::{
    ChangeApplied, ChangeProposed, IdentityRegistry, IdentityRegistryError, RegistryChange,
    RegistryPendingChange, VerifierBound, ADMIN_ACCEPT_LEDGERS,
};

impl Fixture<'_> {
    /// Signs the next call to the registry as `who` and nothing else, so the
    /// call's own authorisation check is what refuses it.
    fn sign_only_as(&self, who: &Address, fn_name: &str, args: Vec<Val>) {
        self.e.mock_auths(&[MockAuth {
            address: who,
            invoke: &MockAuthInvoke {
                contract: &self.registry.address,
                fn_name,
                args,
                sub_invokes: &[],
            },
        }]);
    }

    /// The last call asked `who` alone to sign, once, on exactly this call.
    fn signed_once_by(&self, who: &Address, fn_name: &str, args: Vec<Val>) {
        assert_eq!(
            self.e.auths(),
            std::vec![(
                who.clone(),
                AuthorizedInvocation {
                    function: AuthorizedFunction::Contract((
                        self.registry.address.clone(),
                        Symbol::new(&self.e, fn_name),
                        args,
                    )),
                    sub_invocations: std::vec![],
                },
            )]
        );
    }

    fn another_verifier(&self) -> VerifierDoubleClient<'_> {
        VerifierDoubleClient::new(&self.e, &self.e.register(VerifierDouble, ()))
    }
}

#[test]
fn setup_calls_act_at_once_then_need_the_timelock() {
    let f = unbound();
    let first = f.another_verifier();

    f.registry.bind_verifier(&first.address);
    f.registry.bind_verifier(&f.verifier.address);

    assert_eq!(
        f.e.events().all().filter_by_contract(&f.registry.address),
        [VerifierBound {
            verifier: f.verifier.address.clone()
        }
        .to_xdr(&f.e, &f.registry.address)]
    );
    assert_eq!(f.registry.verifier(), f.verifier.address);

    f.registry.bind_vault(&f.clock.address);
    f.registry.finish_setup();

    refused(
        f.registry.try_bind_verifier(&first.address),
        IdentityRegistryError::UseTimelock,
    );
    refused(
        f.registry
            .try_transfer_admin_role(&Address::generate(&f.e), &(f.e.ledger().sequence() + 100)),
        IdentityRegistryError::UseTimelock,
    );
    assert_eq!(f.registry.verifier(), f.verifier.address);
}

#[test]
fn setup_cannot_finish_without_a_vault() {
    let f = unbound();
    f.registry.bind_verifier(&f.verifier.address);

    refused(
        f.registry.try_finish_setup(),
        IdentityRegistryError::VaultNotBound,
    );
    assert!(f.registry.setup_open());
}

#[test]
fn setup_cannot_finish_without_a_verifier() {
    let f = unbound();
    f.registry.bind_vault(&f.clock.address);

    refused(
        f.registry.try_finish_setup(),
        IdentityRegistryError::VerifierNotBound,
    );
    assert!(f.registry.setup_open());
}

#[test]
fn a_second_vault_or_a_late_vault_is_refused() {
    let f = bound();
    refused(
        f.registry.try_bind_vault(&Address::generate(&f.e)),
        IdentityRegistryError::SetupClosed,
    );

    f.registry.finish_setup();

    refused(
        f.registry.try_bind_vault(&Address::generate(&f.e)),
        IdentityRegistryError::SetupClosed,
    );
    refused(
        f.registry.try_finish_setup(),
        IdentityRegistryError::SetupClosed,
    );
    assert_eq!(f.registry.vault(), Some(f.clock.address.clone()));
}

#[test]
fn an_address_that_reports_no_clock_cannot_be_bound() {
    let f = unbound();

    missing_auth(f.registry.try_bind_vault(&Address::generate(&f.e)));
    assert_eq!(f.registry.vault(), None);
}

fn implements_the_vault_view<T: strata_bindings::VaultBinding>() {}

#[test]
fn the_contract_answers_the_view_the_vault_reads() {
    implements_the_vault_view::<IdentityRegistry>();
    let f = unbound();
    let view = strata_bindings::VaultBindingClient::new(&f.e, &f.registry.address);
    assert_eq!(view.vault(), None);
    assert!(view.setup_open());

    f.registry.bind_vault(&f.clock.address);
    f.registry.bind_verifier(&f.verifier.address);
    f.registry.finish_setup();

    assert_eq!(view.vault(), Some(f.clock.address.clone()));
    assert!(!view.setup_open());
}

#[test]
fn only_the_admin_binds_and_finishes() {
    let f = unbound();
    let stranger = Address::generate(&f.e);
    f.sign_only_as(
        &stranger,
        "bind_vault",
        (f.clock.address.clone(),).into_val(&f.e),
    );
    missing_auth(f.registry.try_bind_vault(&f.clock.address));
    assert_eq!(f.registry.vault(), None);
    f.sign_only_as(
        &stranger,
        "bind_verifier",
        (f.verifier.address.clone(),).into_val(&f.e),
    );
    missing_auth(f.registry.try_bind_verifier(&f.verifier.address));
    f.e.mock_all_auths();
    refused(
        f.registry.try_verifier(),
        IdentityRegistryError::VerifierNotBound,
    );

    let f = bound();
    let stranger = Address::generate(&f.e);
    f.sign_only_as(&stranger, "finish_setup", Vec::new(&f.e));
    missing_auth(f.registry.try_finish_setup());
    assert!(f.registry.setup_open());
}

#[test]
fn only_the_admin_proposes_cancels_and_applies() {
    let f = finished();
    let stranger = Address::generate(&f.e);
    let change = RegistryChange::Compliance(Address::generate(&f.e));
    let id = f.propose(&change);
    f.e.ledger().set_timestamp(NOW + MIN_DELAY);

    f.sign_only_as(
        &stranger,
        "propose_change",
        (change.clone(),).into_val(&f.e),
    );
    missing_auth(f.registry.try_propose_change(&change));
    f.sign_only_as(&stranger, "cancel_change", (id,).into_val(&f.e));
    missing_auth(f.registry.try_cancel_change(&id));
    f.sign_only_as(&stranger, "apply_change", (id,).into_val(&f.e));
    missing_auth(f.registry.try_apply_change(&id));
    f.e.mock_all_auths();
    assert_eq!(f.registry.pending_changes().len(), 1);
}

#[test]
fn proposals_wait_until_setup_is_finished() {
    let f = bound();
    refused(
        f.registry
            .try_propose_change(&RegistryChange::Compliance(Address::generate(&f.e))),
        IdentityRegistryError::SetupOpen,
    );
    assert_eq!(f.registry.pending_changes().len(), 0);
}

#[test]
fn a_change_lands_after_the_delay() {
    let f = finished();
    let next = Address::generate(&f.e);
    let change = RegistryChange::Compliance(next.clone());

    let id = f.registry.propose_change(&change);

    assert_eq!(
        f.registry.pending_changes(),
        vec![
            &f.e,
            RegistryPendingChange {
                id,
                change,
                eta: NOW + MIN_DELAY,
            }
        ]
    );
    refused(
        f.registry.try_apply_change(&id),
        IdentityRegistryError::ChangeNotReady,
    );

    f.e.ledger().set_timestamp(NOW + MIN_DELAY);
    f.registry.apply_change(&id);

    assert_eq!(f.registry.compliance(), next);
    assert_eq!(f.registry.pending_changes().len(), 0);
}

#[test]
fn new_identity_code_is_deployed_for_the_next_onboarding() {
    let f = finished();
    let (_, before) = f.onboarded();
    let release = f.e.upload(InvestorIdentity);

    f.land(&RegistryChange::IdentityWasm(release.clone()));

    assert_eq!(f.registry.identity_wasm(), release);
    let (_, after) = f.onboarded();
    assert_eq!(after.executable(), Some(Executable::Wasm(release)));
    assert_eq!(
        before.executable(),
        Some(Executable::Wasm(f.identity_wasm.clone()))
    );
}

#[test]
fn a_new_verifier_answers_the_next_link() {
    let f = finished();
    let next = f.another_verifier();

    f.land(&RegistryChange::Verifier(next.address.clone()));

    assert_eq!(f.registry.verifier(), next.address);
    let (_, identity) = f.onboarded();
    assert_eq!(next.accepted(), vec![&f.e, identity]);
    assert_eq!(f.verifier.accepted().len(), 0);
}

#[test]
fn a_new_compliance_authority_takes_over() {
    let f = finished();
    let (account, _) = f.onboarded();
    let next = Address::generate(&f.e);

    f.land(&RegistryChange::Compliance(next.clone()));

    refused(
        f.registry.try_remove_identity(&account, &f.compliance),
        IdentityRegistryError::OperatorNotCompliance,
    );
    f.registry.remove_identity(&account, &next);
    assert!(f.registry.is_vetoed(&account));
}

#[test]
fn a_wind_down_refuses_every_change() {
    let f = finished();
    let waiting = f.propose(&RegistryChange::Compliance(Address::generate(&f.e)));
    f.e.ledger().set_timestamp(NOW + MIN_DELAY);

    f.wind_down();

    refused(
        f.registry.try_apply_change(&waiting),
        IdentityRegistryError::WindDownActive,
    );
    for change in [
        RegistryChange::IdentityWasm(f.e.upload(InvestorIdentity)),
        RegistryChange::Verifier(f.another_verifier().address),
        RegistryChange::Compliance(Address::generate(&f.e)),
        RegistryChange::Admin(Address::generate(&f.e)),
    ] {
        refused(
            f.registry.try_propose_change(&change),
            IdentityRegistryError::WindDownActive,
        );
    }
    assert_eq!(f.registry.compliance(), f.compliance);
}

#[test]
fn nothing_lands_while_the_vault_is_paused() {
    let f = finished();
    let id = f.propose(&RegistryChange::Compliance(Address::generate(&f.e)));
    f.e.ledger().set_timestamp(NOW + MIN_DELAY);

    let mut paused = running();
    paused.paused = true;
    f.clock.set(&paused);

    refused(
        f.registry.try_apply_change(&id),
        IdentityRegistryError::VaultPaused,
    );
}

#[test]
fn a_vault_pause_pushes_the_change_back() {
    let f = finished();
    let id = f.propose(&RegistryChange::Compliance(Address::generate(&f.e)));
    let mut resumed = running();
    resumed.paused_secs = 3 * DAY_DURATION;
    f.clock.set(&resumed);
    let eta = NOW + MIN_DELAY + 3 * DAY_DURATION;

    assert_eq!(f.registry.pending_changes().get(0).unwrap().eta, eta);
    f.e.ledger().set_timestamp(eta - 1);
    refused(
        f.registry.try_apply_change(&id),
        IdentityRegistryError::ChangeNotReady,
    );

    f.e.ledger().set_timestamp(eta);
    f.registry.apply_change(&id);
}

#[test]
fn a_change_shorter_than_a_raised_notice_never_lands() {
    let f = finished();
    let id = f.propose(&RegistryChange::Compliance(Address::generate(&f.e)));
    let mut raised = running();
    raised.delay = 30 * DAY_DURATION;
    raised.exit_window = 20 * DAY_DURATION;
    f.clock.set(&raised);
    f.e.ledger().set_timestamp(NOW + 30 * DAY_DURATION);

    refused(
        f.registry.try_apply_change(&id),
        IdentityRegistryError::DelayBelowNotice,
    );
}

#[test]
fn a_cancelled_change_never_lands() {
    let f = finished();
    let id = f.propose(&RegistryChange::Compliance(Address::generate(&f.e)));

    f.registry.cancel_change(&id);

    refused(
        f.registry.try_apply_change(&id),
        IdentityRegistryError::ChangeNotFound,
    );
    assert_eq!(f.registry.compliance(), f.compliance);
}

#[test]
fn proposing_and_applying_read_the_vault_clock_once() {
    let f = finished();
    let before = f.clock.reads();

    let id = f.propose(&RegistryChange::Compliance(Address::generate(&f.e)));
    assert_eq!(f.clock.reads(), before + 1);

    f.e.ledger().set_timestamp(NOW + MIN_DELAY);
    f.registry.apply_change(&id);
    assert_eq!(f.clock.reads(), before + 2);
}

#[test]
fn proposing_and_applying_publish_the_change() {
    let f = finished();
    let change = RegistryChange::Compliance(Address::generate(&f.e));

    let id = f.propose(&change);
    assert_eq!(
        f.e.events().all().filter_by_contract(&f.registry.address),
        [ChangeProposed {
            id,
            change: change.clone(),
            eta: NOW + MIN_DELAY,
        }
        .to_xdr(&f.e, &f.registry.address)]
    );

    f.e.ledger().set_timestamp(NOW + MIN_DELAY);
    f.registry.apply_change(&id);
    let events = f.e.events().all().filter_by_contract(&f.registry.address);
    assert_eq!(
        events.events().last(),
        Some(&ChangeApplied { id, change }.to_xdr(&f.e, &f.registry.address))
    );
}

#[test]
fn setup_cannot_finish_while_a_hand_over_is_pending() {
    let f = bound();
    let next = Address::generate(&f.e);
    f.registry
        .transfer_admin_role(&next, &(f.e.ledger().sequence() + 100));

    refused(
        f.registry.try_finish_setup(),
        IdentityRegistryError::AdminTransferPending,
    );

    f.registry.accept_admin_transfer();
    assert_eq!(f.registry.get_admin(), Some(next.clone()));
    f.registry.finish_setup();
    f.signed_once_by(&next, "finish_setup", Vec::new(&f.e));
    assert!(!f.registry.setup_open());
}

#[test]
fn only_the_nominee_accepts_a_hand_over() {
    let f = bound();
    let next = Address::generate(&f.e);
    f.registry
        .transfer_admin_role(&next, &(f.e.ledger().sequence() + 100));

    for other in [Address::generate(&f.e), f.admin.clone()] {
        f.sign_only_as(&other, "accept_admin_transfer", Vec::new(&f.e));
        missing_auth(f.registry.try_accept_admin_transfer());
    }
    assert_eq!(f.registry.get_admin(), Some(f.admin.clone()));

    f.sign_only_as(&next, "accept_admin_transfer", Vec::new(&f.e));
    f.registry.accept_admin_transfer();
    assert_eq!(f.registry.get_admin(), Some(next));
}

#[test]
fn after_setup_the_admin_hands_over_through_the_timelock() {
    let f = finished();
    let next = Address::generate(&f.e);
    refused(
        f.registry
            .try_transfer_admin_role(&next, &(f.e.ledger().sequence() + 100)),
        IdentityRegistryError::UseTimelock,
    );

    f.land(&RegistryChange::Admin(next.clone()));
    assert_eq!(f.registry.get_admin(), Some(f.admin.clone()));

    f.registry.accept_admin_transfer();

    assert_eq!(f.registry.get_admin(), Some(next));
}

#[test]
fn a_hand_over_after_setup_is_cancelled_at_once() {
    let f = finished();
    let next = Address::generate(&f.e);
    f.land(&RegistryChange::Admin(next.clone()));

    f.registry.transfer_admin_role(&next, &0);

    refused(
        f.registry.try_accept_admin_transfer(),
        RoleTransferError::NoPendingTransfer,
    );
    assert_eq!(f.registry.get_admin(), Some(f.admin.clone()));
}

#[test]
fn an_admin_hand_over_cannot_be_accepted_while_the_vault_winds_down() {
    let f = finished();
    let next = Address::generate(&f.e);
    f.land(&RegistryChange::Admin(next.clone()));
    f.wind_down();

    refused(
        f.registry.try_accept_admin_transfer(),
        IdentityRegistryError::WindDownActive,
    );
    assert_eq!(f.registry.get_admin(), Some(f.admin.clone()));
}

#[test]
fn the_hand_over_offer_is_open_on_its_last_ledger() {
    let f = finished();
    let next = Address::generate(&f.e);
    f.land(&RegistryChange::Admin(next.clone()));
    let offered_at = f.e.ledger().sequence();

    f.e.ledger()
        .with_mut(|l| l.sequence_number = offered_at + ADMIN_ACCEPT_LEDGERS);
    f.registry.accept_admin_transfer();

    assert_eq!(f.registry.get_admin(), Some(next));
}

#[test]
fn the_hand_over_offer_lasts_seven_days_of_ledgers() {
    let f = finished();
    f.land(&RegistryChange::Admin(Address::generate(&f.e)));
    let offered_at = f.e.ledger().sequence();

    f.e.ledger()
        .with_mut(|l| l.sequence_number = offered_at + ADMIN_ACCEPT_LEDGERS + 1);

    refused(
        f.registry.try_accept_admin_transfer(),
        RoleTransferError::NoPendingTransfer,
    );
    assert_eq!(f.registry.get_admin(), Some(f.admin.clone()));
}

#[test]
fn every_call_restores_the_instance_ttl() {
    let f = unbound();
    let next = Address::generate(&f.e);

    f.restores_the_instance(|| f.registry.bind_verifier(&f.verifier.address));
    let mut account = Address::generate(&f.e);
    f.restores_the_instance(|| account = f.onboarded().0);
    f.restores_the_instance(|| {
        f.registry.stored_identity(&account);
    });
    f.restores_the_instance(|| f.registry.remove_identity(&account, &f.compliance));
    f.restores_the_instance(|| f.registry.lift_veto(&account, &f.compliance));
    let other = Address::generate(&f.e);
    let own = f.own_identity(&other);
    f.restores_the_instance(|| f.registry.attach(&other, &own));
    let listed = Address::generate(&f.e);
    let listed_identity = f.own_identity(&listed);
    f.restores_the_instance(|| {
        f.registry
            .add_identity(&listed, &listed_identity, &Vec::new(&f.e), &f.compliance)
    });
    let batched = Address::generate(&f.e);
    let batched_identity = f.own_identity(&batched);
    f.restores_the_instance(|| {
        f.registry.batch_add_identity(
            &vec![&f.e, batched],
            &vec![&f.e, batched_identity],
            &vec![&f.e, Vec::new(&f.e)],
            &f.compliance,
        )
    });
    f.restores_the_instance(|| {
        f.registry
            .transfer_admin_role(&next, &(f.e.ledger().sequence() + ADMIN_ACCEPT_LEDGERS))
    });
    f.restores_the_instance(|| f.registry.transfer_admin_role(&next, &0));
    f.restores_the_instance(|| f.registry.bind_vault(&f.clock.address));
    f.restores_the_instance(|| f.registry.finish_setup());

    let change = RegistryChange::Compliance(f.compliance.clone());
    let mut id = 0;
    f.restores_the_instance(|| id = f.propose(&change));
    f.restores_the_instance(|| f.registry.cancel_change(&id));

    let id = f.propose(&RegistryChange::Admin(next));
    f.e.ledger().with_mut(|l| l.timestamp += MIN_DELAY);
    f.restores_the_instance(|| f.registry.apply_change(&id));
    f.restores_the_instance(|| f.registry.accept_admin_transfer());
}

#[test]
fn each_admin_call_asks_the_admin_for_one_signature() {
    let f = unbound();

    f.registry.bind_verifier(&f.verifier.address);
    f.signed_once_by(
        &f.admin,
        "bind_verifier",
        (f.verifier.address.clone(),).into_val(&f.e),
    );
    f.registry.bind_vault(&f.clock.address);
    f.signed_once_by(
        &f.admin,
        "bind_vault",
        (f.clock.address.clone(),).into_val(&f.e),
    );
    f.registry.finish_setup();
    f.signed_once_by(&f.admin, "finish_setup", Vec::new(&f.e));

    let change = RegistryChange::Compliance(Address::generate(&f.e));
    let id = f.registry.propose_change(&change);
    f.signed_once_by(&f.admin, "propose_change", (change.clone(),).into_val(&f.e));
    f.registry.cancel_change(&id);
    f.signed_once_by(&f.admin, "cancel_change", (id,).into_val(&f.e));

    let id = f.registry.propose_change(&change);
    f.e.ledger().with_mut(|l| l.timestamp += MIN_DELAY);
    f.registry.apply_change(&id);
    f.signed_once_by(&f.admin, "apply_change", (id,).into_val(&f.e));
}

#[test]
fn each_compliance_call_asks_the_authority_for_one_signature() {
    let f = bound();
    let account = Address::generate(&f.e);
    let identity = f.own_identity(&account);
    let none: Vec<Val> = Vec::new(&f.e);

    f.registry
        .add_identity(&account, &identity, &none, &f.compliance);
    f.signed_once_by(
        &f.compliance,
        "add_identity",
        (
            account.clone(),
            identity.clone(),
            none.clone(),
            f.compliance.clone(),
        )
            .into_val(&f.e),
    );
    f.registry.remove_identity(&account, &f.compliance);
    f.signed_once_by(
        &f.compliance,
        "remove_identity",
        (account.clone(), f.compliance.clone()).into_val(&f.e),
    );
    f.registry.lift_veto(&account, &f.compliance);
    f.signed_once_by(
        &f.compliance,
        "lift_veto",
        (account.clone(), f.compliance.clone()).into_val(&f.e),
    );
    let accounts = vec![&f.e, account];
    let identities = vec![&f.e, identity];
    let lists = vec![&f.e, none];
    f.registry
        .batch_add_identity(&accounts, &identities, &lists, &f.compliance);
    f.signed_once_by(
        &f.compliance,
        "batch_add_identity",
        (accounts, identities, lists, f.compliance.clone()).into_val(&f.e),
    );
}
