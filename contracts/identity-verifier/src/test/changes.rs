extern crate std;

use soroban_sdk::{
    testutils::{
        Address as _, AuthorizedFunction, AuthorizedInvocation, Events as _, Ledger as _, MockAuth,
        MockAuthInvoke,
    },
    vec, Address, Event as _, IntoVal, Symbol, Val, Vec,
};
use stellar_access::role_transfer::RoleTransferError;
use stellar_tokens::rwa::{
    identity_verification::identity_registry_storage::IRSError, ClaimTopicsAndIssuersSet,
    IdentityRegistryStorageSet,
};
use strata_timelock::{DAY_DURATION, MIN_DELAY};

use super::{
    bound, finished, missing_auth, refused, running, unavailable, unbound, verified, Fixture,
    TokenSideClient, NOW,
};
use crate::{
    ChangeApplied, ChangeProposed, IdentityVerifier, VerifierChange, VerifierError,
    VerifierPendingChange, ADMIN_ACCEPT_LEDGERS,
};

impl Fixture<'_> {
    /// Signs the next call to the verifier as `who` and nothing else, so the
    /// call's own authorisation check is what refuses it.
    fn sign_only_as(&self, who: &Address, fn_name: &str, args: Vec<Val>) {
        self.e.mock_auths(&[MockAuth {
            address: who,
            invoke: &MockAuthInvoke {
                contract: &self.verifier.address,
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
                        self.verifier.address.clone(),
                        Symbol::new(&self.e, fn_name),
                        args,
                    )),
                    sub_invocations: std::vec![],
                },
            )]
        );
    }

    fn set_topics(&self, topics: &Address, operator: &Address) {
        TokenSideClient::new(&self.e, &self.verifier.address)
            .set_claim_topics_and_issuers(topics, operator);
    }

    fn try_set_topics(
        &self,
        topics: &Address,
        operator: &Address,
    ) -> Result<
        Result<(), soroban_sdk::ConversionError>,
        Result<soroban_sdk::Error, soroban_sdk::InvokeError>,
    > {
        TokenSideClient::new(&self.e, &self.verifier.address)
            .try_set_claim_topics_and_issuers(topics, operator)
    }
}

#[test]
fn setup_calls_act_at_once_then_need_the_timelock() {
    let f = bound();
    let escrow = Address::generate(&f.e);
    let topics = f.topics.address.clone();

    f.verifier.add_protocol_address(&escrow);
    f.set_topics(&topics, &f.admin);
    assert!(f.verifier.is_protocol_address(&escrow));
    assert_eq!(f.verifier.claim_topics_and_issuers(), topics);

    f.verifier.finish_setup();

    refused(
        f.verifier
            .try_add_protocol_address(&Address::generate(&f.e)),
        VerifierError::UseTimelock,
    );
    refused(
        f.verifier.try_remove_protocol_address(&escrow),
        VerifierError::UseTimelock,
    );
    refused(
        f.try_set_topics(&Address::generate(&f.e), &f.admin),
        VerifierError::UseTimelock,
    );
    assert!(f.verifier.is_protocol_address(&escrow));
    assert_eq!(f.verifier.claim_topics_and_issuers(), topics);
}

#[test]
fn setup_cannot_finish_without_a_vault() {
    let f = unbound();

    refused(f.verifier.try_finish_setup(), VerifierError::VaultNotBound);
    assert!(f.verifier.setup_open());
}

#[test]
fn a_second_vault_or_a_late_vault_is_refused() {
    let f = bound();
    refused(
        f.verifier.try_bind_vault(&Address::generate(&f.e)),
        VerifierError::SetupClosed,
    );

    f.verifier.finish_setup();

    refused(
        f.verifier.try_bind_vault(&Address::generate(&f.e)),
        VerifierError::SetupClosed,
    );
    refused(f.verifier.try_finish_setup(), VerifierError::SetupClosed);
    assert_eq!(f.verifier.vault(), Some(f.clock.address.clone()));
}

#[test]
fn an_address_that_reports_no_clock_cannot_be_bound() {
    let f = unbound();

    missing_auth(f.verifier.try_bind_vault(&Address::generate(&f.e)));
    assert_eq!(f.verifier.vault(), None);
}

fn implements_the_vault_view<T: strata_bindings::VaultBinding>() {}

#[test]
fn the_contract_answers_the_view_the_vault_reads() {
    implements_the_vault_view::<IdentityVerifier>();
    let f = unbound();
    let view = strata_bindings::VaultBindingClient::new(&f.e, &f.verifier.address);
    assert_eq!(view.vault(), None);
    assert!(view.setup_open());

    f.verifier.bind_vault(&f.clock.address);
    f.verifier.finish_setup();

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
    missing_auth(f.verifier.try_bind_vault(&f.clock.address));
    assert_eq!(f.verifier.vault(), None);

    let f = bound();
    let stranger = Address::generate(&f.e);
    f.sign_only_as(&stranger, "finish_setup", Vec::new(&f.e));
    missing_auth(f.verifier.try_finish_setup());
    assert!(f.verifier.setup_open());
}

#[test]
fn only_the_admin_changes_protocol_addresses_and_topics() {
    let f = bound();
    let stranger = Address::generate(&f.e);
    let escrow = Address::generate(&f.e);
    let other_topics = Address::generate(&f.e);
    f.verifier.add_protocol_address(&escrow);

    refused(
        f.try_set_topics(&other_topics, &stranger),
        VerifierError::OperatorNotAdmin,
    );
    f.sign_only_as(
        &stranger,
        "set_claim_topics_and_issuers",
        (other_topics.clone(), f.admin.clone()).into_val(&f.e),
    );
    missing_auth(f.try_set_topics(&other_topics, &f.admin));
    f.sign_only_as(
        &stranger,
        "add_protocol_address",
        (stranger.clone(),).into_val(&f.e),
    );
    missing_auth(f.verifier.try_add_protocol_address(&stranger));
    f.sign_only_as(
        &stranger,
        "remove_protocol_address",
        (escrow.clone(),).into_val(&f.e),
    );
    missing_auth(f.verifier.try_remove_protocol_address(&escrow));

    assert_eq!(f.verifier.claim_topics_and_issuers(), f.topics.address);
    assert!(!f.verifier.is_protocol_address(&stranger));
    assert!(f.verifier.is_protocol_address(&escrow));
}

#[test]
fn only_the_admin_proposes_cancels_and_applies() {
    let f = finished();
    let stranger = Address::generate(&f.e);
    let change = VerifierChange::AddProtocolAddress(Address::generate(&f.e));
    let id = f.propose(&change);
    f.e.ledger().set_timestamp(NOW + MIN_DELAY);

    f.sign_only_as(
        &stranger,
        "propose_change",
        (change.clone(),).into_val(&f.e),
    );
    missing_auth(f.verifier.try_propose_change(&change));
    f.sign_only_as(&stranger, "cancel_change", (id,).into_val(&f.e));
    missing_auth(f.verifier.try_cancel_change(&id));
    f.sign_only_as(&stranger, "apply_change", (id,).into_val(&f.e));
    missing_auth(f.verifier.try_apply_change(&id));
    assert_eq!(f.verifier.pending_changes().len(), 1);
}

#[test]
fn proposals_wait_until_setup_is_finished() {
    let f = bound();
    refused(
        f.verifier
            .try_propose_change(&VerifierChange::AddProtocolAddress(Address::generate(&f.e))),
        VerifierError::SetupOpen,
    );
    assert_eq!(f.verifier.pending_changes().len(), 0);
}

#[test]
fn a_change_lands_after_the_delay() {
    let f = finished();
    let escrow = Address::generate(&f.e);
    let change = VerifierChange::AddProtocolAddress(escrow.clone());

    let id = f.verifier.propose_change(&change);

    assert_eq!(
        f.verifier.pending_changes(),
        vec![
            &f.e,
            VerifierPendingChange {
                id,
                change,
                eta: NOW + MIN_DELAY,
            }
        ]
    );
    refused(
        f.verifier.try_apply_change(&id),
        VerifierError::ChangeNotReady,
    );

    f.e.ledger().set_timestamp(NOW + MIN_DELAY);
    f.verifier.apply_change(&id);

    assert!(f.verifier.is_protocol_address(&escrow));
    assert_eq!(f.verifier.pending_changes().len(), 0);
}

#[test]
fn every_change_lands_through_the_timelock() {
    let f = finished();
    let escrow = Address::generate(&f.e);
    let registry = Address::generate(&f.e);
    let topics = Address::generate(&f.e);
    let next = Address::generate(&f.e);

    f.land(&VerifierChange::AddProtocolAddress(escrow.clone()));
    assert!(f.verifier.is_protocol_address(&escrow));
    f.land(&VerifierChange::RemoveProtocolAddress(escrow.clone()));
    assert!(!f.verifier.is_protocol_address(&escrow));
    f.land(&VerifierChange::Registry(registry.clone()));
    assert_eq!(f.verifier.identity_registry(), registry);
    f.land(&VerifierChange::Topics(topics.clone()));
    assert_eq!(f.verifier.claim_topics_and_issuers(), topics);
    f.land(&VerifierChange::Admin(next.clone()));
    f.verifier.accept_admin_transfer();
    assert_eq!(f.verifier.get_admin(), Some(next));
}

#[test]
fn a_new_registry_is_the_one_read() {
    let f = finished();
    let (account, _) = f.onboarded();
    verified(f.verify(&account));

    f.land(&VerifierChange::Registry(
        f.e.register(super::RegistryDouble, ()),
    ));

    refused(f.verify(&account), IRSError::IdentityNotFound);
}

#[test]
fn a_new_topics_contract_is_the_one_read() {
    let f = finished();
    let (account, _) = f.onboarded();
    verified(f.verify(&account));

    f.land(&VerifierChange::Topics(
        f.e.register(super::TopicsDouble, ()),
    ));

    unavailable(f.verify(&account));
}

#[test]
fn registry_and_topics_changes_are_published() {
    let f = finished();
    let registry = Address::generate(&f.e);
    let topics = Address::generate(&f.e);

    f.land(&VerifierChange::Registry(registry.clone()));
    let events = f.e.events().all().filter_by_contract(&f.verifier.address);
    assert_eq!(
        events.events().first(),
        Some(
            &IdentityRegistryStorageSet {
                identity_registry_storage: registry
            }
            .to_xdr(&f.e, &f.verifier.address)
        )
    );

    f.land(&VerifierChange::Topics(topics.clone()));
    let events = f.e.events().all().filter_by_contract(&f.verifier.address);
    assert_eq!(
        events.events().first(),
        Some(
            &ClaimTopicsAndIssuersSet {
                claim_topics_and_issuers: topics
            }
            .to_xdr(&f.e, &f.verifier.address)
        )
    );
}

#[test]
fn a_wind_down_refuses_all_but_removals() {
    let f = finished();
    let escrow = Address::generate(&f.e);
    f.land(&VerifierChange::AddProtocolAddress(escrow.clone()));
    let waiting = f.propose(&VerifierChange::AddProtocolAddress(Address::generate(&f.e)));
    f.e.ledger().with_mut(|l| l.timestamp += MIN_DELAY);

    f.wind_down();

    refused(
        f.verifier.try_apply_change(&waiting),
        VerifierError::WindDownActive,
    );
    for change in [
        VerifierChange::AddProtocolAddress(Address::generate(&f.e)),
        VerifierChange::Registry(Address::generate(&f.e)),
        VerifierChange::Topics(Address::generate(&f.e)),
        VerifierChange::Admin(Address::generate(&f.e)),
    ] {
        refused(
            f.verifier.try_propose_change(&change),
            VerifierError::WindDownActive,
        );
    }

    f.land(&VerifierChange::RemoveProtocolAddress(escrow.clone()));

    assert!(!f.verifier.is_protocol_address(&escrow));
}

#[test]
fn nothing_lands_while_the_vault_is_paused() {
    let f = finished();
    let id = f.propose(&VerifierChange::AddProtocolAddress(Address::generate(&f.e)));
    f.e.ledger().set_timestamp(NOW + MIN_DELAY);

    let mut paused = running();
    paused.paused = true;
    f.clock.set(&paused);

    refused(f.verifier.try_apply_change(&id), VerifierError::VaultPaused);
}

#[test]
fn a_vault_pause_pushes_the_change_back() {
    let f = finished();
    let id = f.propose(&VerifierChange::AddProtocolAddress(Address::generate(&f.e)));
    let mut resumed = running();
    resumed.paused_secs = 3 * DAY_DURATION;
    f.clock.set(&resumed);
    let eta = NOW + MIN_DELAY + 3 * DAY_DURATION;

    assert_eq!(f.verifier.pending_changes().get(0).unwrap().eta, eta);
    f.e.ledger().set_timestamp(eta - 1);
    refused(
        f.verifier.try_apply_change(&id),
        VerifierError::ChangeNotReady,
    );

    f.e.ledger().set_timestamp(eta);
    f.verifier.apply_change(&id);
}

#[test]
fn a_change_shorter_than_a_raised_notice_never_lands() {
    let f = finished();
    let id = f.propose(&VerifierChange::AddProtocolAddress(Address::generate(&f.e)));
    let mut raised = running();
    raised.delay = 30 * DAY_DURATION;
    raised.exit_window = 20 * DAY_DURATION;
    f.clock.set(&raised);
    f.e.ledger().set_timestamp(NOW + 30 * DAY_DURATION);

    refused(
        f.verifier.try_apply_change(&id),
        VerifierError::DelayBelowNotice,
    );
}

#[test]
fn a_cancelled_change_never_lands() {
    let f = finished();
    let escrow = Address::generate(&f.e);
    let id = f.propose(&VerifierChange::AddProtocolAddress(escrow.clone()));

    f.verifier.cancel_change(&id);

    refused(
        f.verifier.try_apply_change(&id),
        VerifierError::ChangeNotFound,
    );
    assert!(!f.verifier.is_protocol_address(&escrow));
}

#[test]
fn proposing_and_applying_read_the_vault_clock_once() {
    let f = finished();
    let before = f.clock.reads();

    let id = f.propose(&VerifierChange::AddProtocolAddress(Address::generate(&f.e)));
    assert_eq!(f.clock.reads(), before + 1);

    f.e.ledger().set_timestamp(NOW + MIN_DELAY);
    f.verifier.apply_change(&id);
    assert_eq!(f.clock.reads(), before + 2);
}

#[test]
fn proposing_and_applying_publish_the_change() {
    let f = finished();
    let change = VerifierChange::AddProtocolAddress(Address::generate(&f.e));

    let id = f.propose(&change);
    assert_eq!(
        f.e.events().all().filter_by_contract(&f.verifier.address),
        [ChangeProposed {
            id,
            change: change.clone(),
            eta: NOW + MIN_DELAY,
        }
        .to_xdr(&f.e, &f.verifier.address)]
    );

    f.e.ledger().set_timestamp(NOW + MIN_DELAY);
    f.verifier.apply_change(&id);
    let events = f.e.events().all().filter_by_contract(&f.verifier.address);
    assert_eq!(
        events.events().last(),
        Some(&ChangeApplied { id, change }.to_xdr(&f.e, &f.verifier.address))
    );
}

#[test]
fn setup_cannot_finish_while_a_hand_over_is_pending() {
    let f = bound();
    let next = Address::generate(&f.e);
    f.verifier
        .transfer_admin_role(&next, &(f.e.ledger().sequence() + 100));

    refused(
        f.verifier.try_finish_setup(),
        VerifierError::AdminTransferPending,
    );

    f.verifier.accept_admin_transfer();
    assert_eq!(f.verifier.get_admin(), Some(next.clone()));
    f.verifier.finish_setup();
    f.signed_once_by(&next, "finish_setup", Vec::new(&f.e));
    assert!(!f.verifier.setup_open());
}

#[test]
fn only_the_nominee_accepts_a_hand_over() {
    let f = bound();
    let next = Address::generate(&f.e);
    f.verifier
        .transfer_admin_role(&next, &(f.e.ledger().sequence() + 100));

    for other in [Address::generate(&f.e), f.admin.clone()] {
        f.sign_only_as(&other, "accept_admin_transfer", Vec::new(&f.e));
        missing_auth(f.verifier.try_accept_admin_transfer());
    }
    assert_eq!(f.verifier.get_admin(), Some(f.admin.clone()));

    f.sign_only_as(&next, "accept_admin_transfer", Vec::new(&f.e));
    f.verifier.accept_admin_transfer();
    assert_eq!(f.verifier.get_admin(), Some(next));
}

#[test]
fn after_setup_the_admin_hands_over_through_the_timelock() {
    let f = finished();
    let next = Address::generate(&f.e);
    refused(
        f.verifier
            .try_transfer_admin_role(&next, &(f.e.ledger().sequence() + 100)),
        VerifierError::UseTimelock,
    );

    f.land(&VerifierChange::Admin(next.clone()));
    assert_eq!(f.verifier.get_admin(), Some(f.admin.clone()));

    f.verifier.accept_admin_transfer();

    assert_eq!(f.verifier.get_admin(), Some(next));
}

#[test]
fn a_hand_over_after_setup_is_cancelled_at_once() {
    let f = finished();
    let next = Address::generate(&f.e);
    f.land(&VerifierChange::Admin(next.clone()));

    f.verifier.transfer_admin_role(&next, &0);

    refused(
        f.verifier.try_accept_admin_transfer(),
        RoleTransferError::NoPendingTransfer,
    );
    assert_eq!(f.verifier.get_admin(), Some(f.admin.clone()));
}

#[test]
fn an_admin_hand_over_cannot_be_accepted_while_the_vault_winds_down() {
    let f = finished();
    let next = Address::generate(&f.e);
    f.land(&VerifierChange::Admin(next.clone()));
    f.wind_down();

    refused(
        f.verifier.try_accept_admin_transfer(),
        VerifierError::WindDownActive,
    );
    assert_eq!(f.verifier.get_admin(), Some(f.admin.clone()));
}

#[test]
fn the_hand_over_offer_is_open_on_its_last_ledger() {
    let f = finished();
    let next = Address::generate(&f.e);
    f.land(&VerifierChange::Admin(next.clone()));
    let offered_at = f.e.ledger().sequence();

    f.e.ledger()
        .with_mut(|l| l.sequence_number = offered_at + ADMIN_ACCEPT_LEDGERS);
    f.verifier.accept_admin_transfer();

    assert_eq!(f.verifier.get_admin(), Some(next));
}

#[test]
fn the_hand_over_offer_lasts_seven_days_of_ledgers() {
    let f = finished();
    f.land(&VerifierChange::Admin(Address::generate(&f.e)));
    let offered_at = f.e.ledger().sequence();

    f.e.ledger()
        .with_mut(|l| l.sequence_number = offered_at + ADMIN_ACCEPT_LEDGERS + 1);

    refused(
        f.verifier.try_accept_admin_transfer(),
        RoleTransferError::NoPendingTransfer,
    );
    assert_eq!(f.verifier.get_admin(), Some(f.admin.clone()));
}

#[test]
fn every_admin_call_restores_the_instance_ttl() {
    let f = unbound();
    let next = Address::generate(&f.e);
    let escrow = Address::generate(&f.e);
    let topics = f.topics.address.clone();

    f.restores_the_instance(|| f.verifier.add_protocol_address(&escrow));
    f.restores_the_instance(|| f.verifier.remove_protocol_address(&escrow));
    f.restores_the_instance(|| f.set_topics(&topics, &f.admin));
    f.restores_the_instance(|| {
        f.verifier
            .transfer_admin_role(&next, &(f.e.ledger().sequence() + ADMIN_ACCEPT_LEDGERS))
    });
    f.restores_the_instance(|| f.verifier.transfer_admin_role(&next, &0));
    f.restores_the_instance(|| f.verifier.bind_vault(&f.clock.address));
    f.restores_the_instance(|| f.verifier.finish_setup());

    let change = VerifierChange::AddProtocolAddress(escrow);
    let mut id = 0;
    f.restores_the_instance(|| id = f.propose(&change));
    f.restores_the_instance(|| f.verifier.cancel_change(&id));

    let id = f.propose(&VerifierChange::Admin(next));
    f.e.ledger().with_mut(|l| l.timestamp += MIN_DELAY);
    f.restores_the_instance(|| f.verifier.apply_change(&id));
    f.restores_the_instance(|| f.verifier.accept_admin_transfer());
}

#[test]
fn each_admin_call_asks_the_admin_for_one_signature() {
    let f = unbound();
    let escrow = Address::generate(&f.e);
    let topics = f.topics.address.clone();

    f.verifier.add_protocol_address(&escrow);
    f.signed_once_by(
        &f.admin,
        "add_protocol_address",
        (escrow.clone(),).into_val(&f.e),
    );
    f.verifier.remove_protocol_address(&escrow);
    f.signed_once_by(
        &f.admin,
        "remove_protocol_address",
        (escrow.clone(),).into_val(&f.e),
    );
    f.set_topics(&topics, &f.admin);
    f.signed_once_by(
        &f.admin,
        "set_claim_topics_and_issuers",
        (topics.clone(), f.admin.clone()).into_val(&f.e),
    );

    f.verifier.bind_vault(&f.clock.address);
    f.signed_once_by(
        &f.admin,
        "bind_vault",
        (f.clock.address.clone(),).into_val(&f.e),
    );
    f.verifier.finish_setup();
    f.signed_once_by(&f.admin, "finish_setup", Vec::new(&f.e));

    let change = VerifierChange::AddProtocolAddress(escrow);
    let id = f.verifier.propose_change(&change);
    f.signed_once_by(&f.admin, "propose_change", (change.clone(),).into_val(&f.e));
    f.verifier.cancel_change(&id);
    f.signed_once_by(&f.admin, "cancel_change", (id,).into_val(&f.e));

    let id = f.verifier.propose_change(&change);
    f.e.ledger().with_mut(|l| l.timestamp += MIN_DELAY);
    f.verifier.apply_change(&id);
    f.signed_once_by(&f.admin, "apply_change", (id,).into_val(&f.e));
}
