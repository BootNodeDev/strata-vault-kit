extern crate std;

use soroban_sdk::{
    testutils::{
        Address as _, AuthorizedFunction, AuthorizedInvocation, Events as _, Ledger as _, MockAuth,
        MockAuthInvoke,
    },
    vec, Address, Event as _, IntoVal, Symbol, Val, Vec,
};
use stellar_access::role_transfer::RoleTransferError;
use stellar_tokens::rwa::identity_verification::claim_topics_and_issuers::ClaimTopicsAndIssuersError;
use strata_timelock::{DAY_DURATION, MIN_DELAY};

use super::{
    bound, finished, missing_auth, refused, running, topics, unbound, Fixture, ForeignIssuer,
};
use crate::{
    ChangeApplied, ChangeProposed, ClaimTopics, ClaimTopicsContractError, TopicsChange,
    TopicsPendingChange, ADMIN_ACCEPT_LEDGERS,
};

const KYC: u32 = 1;
const AML: u32 = 2;

impl Fixture<'_> {
    /// Signs the next call to the topics contract as `who` and nothing else,
    /// so the call's own authorisation check is what refuses it.
    fn sign_only_as(&self, who: &Address, fn_name: &str, args: Vec<Val>) {
        self.e.mock_auths(&[MockAuth {
            address: who,
            invoke: &MockAuthInvoke {
                contract: &self.topics.address,
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
                        self.topics.address.clone(),
                        Symbol::new(&self.e, fn_name),
                        args,
                    )),
                    sub_invocations: std::vec![],
                },
            )]
        );
    }
}

#[test]
fn setup_calls_act_at_once_then_need_the_timelock() {
    let f = bound();
    let kept = f.kit_issuer();
    let dropped = f.kit_issuer();

    f.topics.add_claim_topic(&KYC, &f.admin);
    f.topics.add_claim_topic(&AML, &f.admin);
    f.topics
        .add_trusted_issuer(&kept, &topics(&f.e, &[KYC]), &f.admin);
    f.topics
        .add_trusted_issuer(&dropped, &topics(&f.e, &[KYC]), &f.admin);
    f.topics
        .update_issuer_claim_topics(&kept, &topics(&f.e, &[KYC, AML]), &f.admin);
    f.topics.remove_trusted_issuer(&dropped, &f.admin);

    assert_eq!(f.topics.get_claim_topics(), topics(&f.e, &[KYC, AML]));
    assert_eq!(f.topics.get_trusted_issuers(), vec![&f.e, kept.clone()]);
    assert!(f.topics.has_claim_topic(&kept, &AML));

    f.topics.finish_setup();
    let issuer = f.kit_issuer();

    refused(
        f.topics.try_add_claim_topic(&3, &f.admin),
        ClaimTopicsContractError::UseTimelock,
    );
    refused(
        f.topics.try_remove_claim_topic(&AML, &f.admin),
        ClaimTopicsContractError::UseTimelock,
    );
    refused(
        f.topics
            .try_add_trusted_issuer(&issuer, &topics(&f.e, &[KYC]), &f.admin),
        ClaimTopicsContractError::UseTimelock,
    );
    refused(
        f.topics.try_remove_trusted_issuer(&kept, &f.admin),
        ClaimTopicsContractError::UseTimelock,
    );
    refused(
        f.topics
            .try_update_issuer_claim_topics(&kept, &topics(&f.e, &[KYC]), &f.admin),
        ClaimTopicsContractError::UseTimelock,
    );
    assert_eq!(f.topics.get_claim_topics(), topics(&f.e, &[KYC, AML]));
    assert_eq!(f.topics.get_trusted_issuers(), vec![&f.e, kept]);
}

#[test]
fn setup_cannot_finish_without_a_vault() {
    let f = unbound();

    refused(
        f.topics.try_finish_setup(),
        ClaimTopicsContractError::VaultNotBound,
    );
    assert!(f.topics.setup_open());
}

#[test]
fn a_second_vault_or_a_late_vault_is_refused() {
    let f = bound();
    refused(
        f.topics.try_bind_vault(&Address::generate(&f.e)),
        ClaimTopicsContractError::SetupClosed,
    );

    f.topics.finish_setup();

    refused(
        f.topics.try_bind_vault(&Address::generate(&f.e)),
        ClaimTopicsContractError::SetupClosed,
    );
    refused(
        f.topics.try_finish_setup(),
        ClaimTopicsContractError::SetupClosed,
    );
    assert_eq!(f.topics.vault(), Some(f.clock.address.clone()));
}

#[test]
fn an_address_that_reports_no_clock_cannot_be_bound() {
    let f = unbound();

    missing_auth(f.topics.try_bind_vault(&Address::generate(&f.e)));
    assert_eq!(f.topics.vault(), None);
}

fn implements_the_vault_view<T: strata_bindings::VaultBinding>() {}

#[test]
fn the_contract_answers_the_view_the_vault_reads() {
    implements_the_vault_view::<ClaimTopics>();
    let f = unbound();
    let view = strata_bindings::VaultBindingClient::new(&f.e, &f.topics.address);
    assert_eq!(view.vault(), None);
    assert!(view.setup_open());

    f.topics.bind_vault(&f.clock.address);
    f.topics.finish_setup();

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
    missing_auth(f.topics.try_bind_vault(&f.clock.address));
    assert_eq!(f.topics.vault(), None);

    let f = bound();
    let stranger = Address::generate(&f.e);
    f.sign_only_as(&stranger, "finish_setup", Vec::new(&f.e));
    missing_auth(f.topics.try_finish_setup());
    assert!(f.topics.setup_open());
}

#[test]
fn only_the_admin_changes_topics() {
    let f = bound();
    let issuer = f.kit_issuer();
    f.topics.add_claim_topic(&KYC, &f.admin);
    f.topics
        .add_trusted_issuer(&issuer, &topics(&f.e, &[KYC]), &f.admin);
    let other = f.kit_issuer();
    let stranger = Address::generate(&f.e);
    let kyc = topics(&f.e, &[KYC]);

    refused(
        f.topics.try_add_claim_topic(&AML, &stranger),
        ClaimTopicsContractError::OperatorNotAdmin,
    );
    refused(
        f.topics.try_remove_claim_topic(&KYC, &stranger),
        ClaimTopicsContractError::OperatorNotAdmin,
    );
    refused(
        f.topics.try_add_trusted_issuer(&other, &kyc, &stranger),
        ClaimTopicsContractError::OperatorNotAdmin,
    );
    refused(
        f.topics.try_remove_trusted_issuer(&issuer, &stranger),
        ClaimTopicsContractError::OperatorNotAdmin,
    );
    refused(
        f.topics
            .try_update_issuer_claim_topics(&issuer, &kyc, &stranger),
        ClaimTopicsContractError::OperatorNotAdmin,
    );

    f.sign_only_as(
        &stranger,
        "add_claim_topic",
        (AML, f.admin.clone()).into_val(&f.e),
    );
    missing_auth(f.topics.try_add_claim_topic(&AML, &f.admin));
    f.sign_only_as(
        &stranger,
        "remove_claim_topic",
        (KYC, f.admin.clone()).into_val(&f.e),
    );
    missing_auth(f.topics.try_remove_claim_topic(&KYC, &f.admin));
    f.sign_only_as(
        &stranger,
        "add_trusted_issuer",
        (other.clone(), kyc.clone(), f.admin.clone()).into_val(&f.e),
    );
    missing_auth(f.topics.try_add_trusted_issuer(&other, &kyc, &f.admin));
    f.sign_only_as(
        &stranger,
        "remove_trusted_issuer",
        (issuer.clone(), f.admin.clone()).into_val(&f.e),
    );
    missing_auth(f.topics.try_remove_trusted_issuer(&issuer, &f.admin));
    f.sign_only_as(
        &stranger,
        "update_issuer_claim_topics",
        (issuer.clone(), kyc.clone(), f.admin.clone()).into_val(&f.e),
    );
    missing_auth(
        f.topics
            .try_update_issuer_claim_topics(&issuer, &kyc, &f.admin),
    );

    assert_eq!(f.topics.get_claim_topics(), kyc);
    assert_eq!(f.topics.get_trusted_issuers(), vec![&f.e, issuer]);
}

#[test]
fn only_the_admin_proposes_cancels_and_applies() {
    let f = finished();
    let stranger = Address::generate(&f.e);
    let change = TopicsChange::AddClaimTopic(KYC);
    let id = f.propose(&change);
    f.e.ledger().set_timestamp(10_000 + MIN_DELAY);

    f.sign_only_as(
        &stranger,
        "propose_change",
        (change.clone(),).into_val(&f.e),
    );
    missing_auth(f.topics.try_propose_change(&change));
    f.sign_only_as(&stranger, "cancel_change", (id,).into_val(&f.e));
    missing_auth(f.topics.try_cancel_change(&id));
    f.sign_only_as(&stranger, "apply_change", (id,).into_val(&f.e));
    missing_auth(f.topics.try_apply_change(&id));
    assert_eq!(f.topics.pending_changes().len(), 1);
}

#[test]
fn proposals_wait_until_setup_is_finished() {
    let f = bound();
    refused(
        f.topics
            .try_propose_change(&TopicsChange::AddClaimTopic(KYC)),
        ClaimTopicsContractError::SetupOpen,
    );
    assert_eq!(f.topics.pending_changes().len(), 0);
}

#[test]
fn a_change_lands_after_the_delay() {
    let f = finished();
    let change = TopicsChange::AddClaimTopic(KYC);

    let id = f.topics.propose_change(&change);

    assert_eq!(
        f.topics.pending_changes(),
        vec![
            &f.e,
            TopicsPendingChange {
                id,
                change,
                eta: 10_000 + MIN_DELAY,
            }
        ]
    );
    refused(
        f.topics.try_apply_change(&id),
        ClaimTopicsContractError::ChangeNotReady,
    );

    f.e.ledger().set_timestamp(10_000 + MIN_DELAY);
    f.topics.apply_change(&id);

    assert_eq!(f.topics.get_claim_topics(), topics(&f.e, &[KYC]));
    assert_eq!(f.topics.pending_changes().len(), 0);
}

#[test]
fn every_change_lands_through_the_timelock() {
    let f = bound();
    let early = f.kit_issuer();
    f.topics.add_claim_topic(&KYC, &f.admin);
    f.topics
        .add_trusted_issuer(&early, &topics(&f.e, &[KYC]), &f.admin);
    f.topics.finish_setup();
    let late = f.kit_issuer();

    f.land(&TopicsChange::AddClaimTopic(AML));
    f.land(&TopicsChange::AddTrustedIssuer(
        late.clone(),
        topics(&f.e, &[AML]),
    ));
    f.land(&TopicsChange::UpdateIssuerTopics(
        late.clone(),
        topics(&f.e, &[KYC, AML]),
    ));
    f.land(&TopicsChange::RemoveTrustedIssuer(early));
    f.land(&TopicsChange::RemoveClaimTopic(AML));

    assert_eq!(f.topics.get_claim_topics(), topics(&f.e, &[KYC]));
    assert_eq!(f.topics.get_trusted_issuers(), vec![&f.e, late.clone()]);
    assert_eq!(
        f.topics.get_trusted_issuer_claim_topics(&late),
        topics(&f.e, &[KYC])
    );
}

#[test]
fn a_change_open_zeppelin_refuses_stays_queued() {
    let f = finished();
    let id = f.propose(&TopicsChange::RemoveClaimTopic(KYC));
    f.e.ledger().set_timestamp(10_000 + MIN_DELAY);

    refused(
        f.topics.try_apply_change(&id),
        ClaimTopicsAndIssuersError::ClaimTopicDoesNotExist,
    );
    assert_eq!(f.topics.pending_changes().len(), 1);
}

#[test]
fn a_wind_down_refuses_all_but_removals() {
    let f = bound();
    let issuer = f.kit_issuer();
    f.topics.add_claim_topic(&KYC, &f.admin);
    f.topics.add_claim_topic(&AML, &f.admin);
    f.topics
        .add_trusted_issuer(&issuer, &topics(&f.e, &[KYC, AML]), &f.admin);
    f.topics.finish_setup();
    let waiting = f.propose(&TopicsChange::AddClaimTopic(3));
    f.e.ledger().set_timestamp(10_000 + MIN_DELAY);

    f.wind_down();

    refused(
        f.topics.try_apply_change(&waiting),
        ClaimTopicsContractError::WindDownActive,
    );
    for change in [
        TopicsChange::AddClaimTopic(4),
        TopicsChange::AddTrustedIssuer(f.kit_issuer(), topics(&f.e, &[KYC])),
        TopicsChange::UpdateIssuerTopics(issuer.clone(), topics(&f.e, &[KYC])),
        TopicsChange::IssuerWasm(f.e.upload(ForeignIssuer)),
        TopicsChange::Admin(Address::generate(&f.e)),
    ] {
        refused(
            f.topics.try_propose_change(&change),
            ClaimTopicsContractError::WindDownActive,
        );
    }

    f.land(&TopicsChange::RemoveTrustedIssuer(issuer));
    f.land(&TopicsChange::RemoveClaimTopic(AML));

    assert_eq!(f.topics.get_trusted_issuers().len(), 0);
    assert_eq!(f.topics.get_claim_topics(), topics(&f.e, &[KYC]));
}

#[test]
fn nothing_lands_while_the_vault_is_paused() {
    let f = bound();
    f.topics.add_claim_topic(&KYC, &f.admin);
    f.topics.finish_setup();
    let id = f.propose(&TopicsChange::RemoveClaimTopic(KYC));
    f.e.ledger().set_timestamp(10_000 + MIN_DELAY);

    let mut paused = running();
    paused.paused = true;
    f.clock.set(&paused);

    refused(
        f.topics.try_apply_change(&id),
        ClaimTopicsContractError::VaultPaused,
    );
}

#[test]
fn a_vault_pause_pushes_the_change_back() {
    let f = finished();
    let id = f.propose(&TopicsChange::AddClaimTopic(KYC));
    let mut resumed = running();
    resumed.paused_secs = 3 * DAY_DURATION;
    f.clock.set(&resumed);
    let eta = 10_000 + MIN_DELAY + 3 * DAY_DURATION;

    assert_eq!(f.topics.pending_changes().get(0).unwrap().eta, eta);
    f.e.ledger().set_timestamp(eta - 1);
    refused(
        f.topics.try_apply_change(&id),
        ClaimTopicsContractError::ChangeNotReady,
    );

    f.e.ledger().set_timestamp(eta);
    f.topics.apply_change(&id);
}

#[test]
fn a_change_shorter_than_a_raised_notice_never_lands() {
    let f = finished();
    let id = f.propose(&TopicsChange::AddClaimTopic(KYC));
    let mut raised = running();
    raised.delay = 30 * DAY_DURATION;
    raised.exit_window = 20 * DAY_DURATION;
    f.clock.set(&raised);
    f.e.ledger().set_timestamp(10_000 + 30 * DAY_DURATION);

    refused(
        f.topics.try_apply_change(&id),
        ClaimTopicsContractError::DelayBelowNotice,
    );
}

#[test]
fn a_cancelled_change_never_lands() {
    let f = finished();
    let id = f.propose(&TopicsChange::AddClaimTopic(KYC));

    f.topics.cancel_change(&id);

    refused(
        f.topics.try_apply_change(&id),
        ClaimTopicsContractError::ChangeNotFound,
    );
    assert_eq!(f.topics.get_claim_topics().len(), 0);
}

#[test]
fn proposing_and_applying_read_the_vault_clock_once() {
    let f = finished();
    let before = f.clock.reads();

    let id = f.propose(&TopicsChange::AddClaimTopic(KYC));
    assert_eq!(f.clock.reads(), before + 1);

    f.e.ledger().set_timestamp(10_000 + MIN_DELAY);
    f.topics.apply_change(&id);
    assert_eq!(f.clock.reads(), before + 2);
}

#[test]
fn proposing_and_applying_publish_the_change() {
    let f = finished();
    let change = TopicsChange::AddClaimTopic(KYC);

    let id = f.propose(&change);
    assert_eq!(
        f.e.events().all().filter_by_contract(&f.topics.address),
        [ChangeProposed {
            id,
            change: change.clone(),
            eta: 10_000 + MIN_DELAY,
        }
        .to_xdr(&f.e, &f.topics.address)]
    );

    f.e.ledger().set_timestamp(10_000 + MIN_DELAY);
    f.topics.apply_change(&id);
    let events = f.e.events().all().filter_by_contract(&f.topics.address);
    assert_eq!(
        events.events().last(),
        Some(&ChangeApplied { id, change }.to_xdr(&f.e, &f.topics.address))
    );
}

#[test]
fn is_complete_needs_an_issuer_for_every_topic() {
    let f = bound();
    let first = f.kit_issuer();
    let second = f.kit_issuer();
    assert!(!f.topics.is_complete());

    f.topics.add_claim_topic(&KYC, &f.admin);
    assert!(!f.topics.is_complete());

    f.topics
        .add_trusted_issuer(&first, &topics(&f.e, &[KYC]), &f.admin);
    assert!(f.topics.is_complete());

    f.topics.add_claim_topic(&AML, &f.admin);
    assert!(!f.topics.is_complete());

    f.topics
        .add_trusted_issuer(&second, &topics(&f.e, &[AML]), &f.admin);
    assert!(f.topics.is_complete());

    f.topics.remove_trusted_issuer(&first, &f.admin);
    assert!(!f.topics.is_complete());
}

#[test]
fn moving_a_topics_only_issuer_to_other_topics_leaves_it_incomplete() {
    let f = bound();
    let issuer = f.kit_issuer();
    f.topics.add_claim_topic(&KYC, &f.admin);
    f.topics.add_claim_topic(&AML, &f.admin);
    f.topics
        .add_trusted_issuer(&issuer, &topics(&f.e, &[KYC, AML]), &f.admin);
    f.topics.finish_setup();
    assert!(f.topics.is_complete());

    f.land(&TopicsChange::UpdateIssuerTopics(
        issuer.clone(),
        topics(&f.e, &[AML]),
    ));

    assert!(f.topics.get_claim_topic_issuers(&KYC).is_empty());
    assert!(!f.topics.is_complete());
}

#[test]
fn setup_cannot_finish_while_a_hand_over_is_pending() {
    let f = bound();
    let next = Address::generate(&f.e);
    f.topics
        .transfer_admin_role(&next, &(f.e.ledger().sequence() + 100));

    refused(
        f.topics.try_finish_setup(),
        ClaimTopicsContractError::AdminTransferPending,
    );

    f.topics.accept_admin_transfer();
    assert_eq!(f.topics.get_admin(), Some(next.clone()));
    f.topics.finish_setup();
    f.signed_once_by(&next, "finish_setup", Vec::new(&f.e));
    assert!(!f.topics.setup_open());
}

#[test]
fn only_the_nominee_accepts_a_hand_over() {
    let f = bound();
    let next = Address::generate(&f.e);
    f.topics
        .transfer_admin_role(&next, &(f.e.ledger().sequence() + 100));

    for other in [Address::generate(&f.e), f.admin.clone()] {
        f.sign_only_as(&other, "accept_admin_transfer", Vec::new(&f.e));
        missing_auth(f.topics.try_accept_admin_transfer());
    }
    assert_eq!(f.topics.get_admin(), Some(f.admin.clone()));

    f.sign_only_as(&next, "accept_admin_transfer", Vec::new(&f.e));
    f.topics.accept_admin_transfer();
    assert_eq!(f.topics.get_admin(), Some(next));
}

#[test]
fn after_setup_the_admin_hands_over_through_the_timelock() {
    let f = finished();
    let next = Address::generate(&f.e);
    refused(
        f.topics
            .try_transfer_admin_role(&next, &(f.e.ledger().sequence() + 100)),
        ClaimTopicsContractError::UseTimelock,
    );

    f.land(&TopicsChange::Admin(next.clone()));
    assert_eq!(f.topics.get_admin(), Some(f.admin.clone()));

    f.topics.accept_admin_transfer();

    assert_eq!(f.topics.get_admin(), Some(next));
}

#[test]
fn a_hand_over_after_setup_is_cancelled_at_once() {
    let f = finished();
    let next = Address::generate(&f.e);
    f.land(&TopicsChange::Admin(next.clone()));

    f.topics.transfer_admin_role(&next, &0);

    refused(
        f.topics.try_accept_admin_transfer(),
        RoleTransferError::NoPendingTransfer,
    );
    assert_eq!(f.topics.get_admin(), Some(f.admin.clone()));
}

#[test]
fn an_admin_hand_over_cannot_be_accepted_while_the_vault_winds_down() {
    let f = finished();
    let next = Address::generate(&f.e);
    f.land(&TopicsChange::Admin(next.clone()));
    f.wind_down();

    refused(
        f.topics.try_accept_admin_transfer(),
        ClaimTopicsContractError::WindDownActive,
    );
    assert_eq!(f.topics.get_admin(), Some(f.admin.clone()));
}

#[test]
fn the_hand_over_offer_is_open_on_its_last_ledger() {
    let f = finished();
    let next = Address::generate(&f.e);
    f.land(&TopicsChange::Admin(next.clone()));
    let offered_at = f.e.ledger().sequence();

    f.e.ledger()
        .with_mut(|l| l.sequence_number = offered_at + ADMIN_ACCEPT_LEDGERS);
    f.topics.accept_admin_transfer();

    assert_eq!(f.topics.get_admin(), Some(next));
}

#[test]
fn the_hand_over_offer_lasts_seven_days_of_ledgers() {
    let f = finished();
    f.land(&TopicsChange::Admin(Address::generate(&f.e)));
    let offered_at = f.e.ledger().sequence();

    f.e.ledger()
        .with_mut(|l| l.sequence_number = offered_at + ADMIN_ACCEPT_LEDGERS + 1);

    refused(
        f.topics.try_accept_admin_transfer(),
        RoleTransferError::NoPendingTransfer,
    );
    assert_eq!(f.topics.get_admin(), Some(f.admin.clone()));
}

#[test]
fn every_admin_call_restores_the_instance_ttl() {
    let f = unbound();
    let next = Address::generate(&f.e);
    let issuer = f.kit_issuer();
    let kyc = topics(&f.e, &[KYC]);

    f.restores_the_instance(|| f.topics.add_claim_topic(&KYC, &f.admin));
    f.restores_the_instance(|| f.topics.add_trusted_issuer(&issuer, &kyc, &f.admin));
    f.restores_the_instance(|| f.topics.update_issuer_claim_topics(&issuer, &kyc, &f.admin));
    f.restores_the_instance(|| f.topics.remove_trusted_issuer(&issuer, &f.admin));
    f.restores_the_instance(|| f.topics.remove_claim_topic(&KYC, &f.admin));
    f.restores_the_instance(|| {
        f.topics
            .transfer_admin_role(&next, &(f.e.ledger().sequence() + ADMIN_ACCEPT_LEDGERS))
    });
    f.restores_the_instance(|| f.topics.transfer_admin_role(&next, &0));
    f.restores_the_instance(|| f.topics.bind_vault(&f.clock.address));
    f.restores_the_instance(|| f.topics.finish_setup());

    let change = TopicsChange::AddClaimTopic(KYC);
    let mut id = 0;
    f.restores_the_instance(|| id = f.propose(&change));
    f.restores_the_instance(|| f.topics.cancel_change(&id));

    let id = f.propose(&TopicsChange::Admin(next));
    f.e.ledger().with_mut(|l| l.timestamp += MIN_DELAY);
    f.restores_the_instance(|| f.topics.apply_change(&id));
    f.restores_the_instance(|| f.topics.accept_admin_transfer());
}

#[test]
fn each_admin_call_asks_the_admin_for_one_signature() {
    let f = unbound();
    let issuer = f.kit_issuer();
    let kyc = topics(&f.e, &[KYC]);

    f.topics.add_claim_topic(&KYC, &f.admin);
    f.signed_once_by(
        &f.admin,
        "add_claim_topic",
        (KYC, f.admin.clone()).into_val(&f.e),
    );
    f.topics.add_trusted_issuer(&issuer, &kyc, &f.admin);
    f.signed_once_by(
        &f.admin,
        "add_trusted_issuer",
        (issuer.clone(), kyc.clone(), f.admin.clone()).into_val(&f.e),
    );
    f.topics.update_issuer_claim_topics(&issuer, &kyc, &f.admin);
    f.signed_once_by(
        &f.admin,
        "update_issuer_claim_topics",
        (issuer.clone(), kyc.clone(), f.admin.clone()).into_val(&f.e),
    );
    f.topics.remove_trusted_issuer(&issuer, &f.admin);
    f.signed_once_by(
        &f.admin,
        "remove_trusted_issuer",
        (issuer, f.admin.clone()).into_val(&f.e),
    );
    f.topics.remove_claim_topic(&KYC, &f.admin);
    f.signed_once_by(
        &f.admin,
        "remove_claim_topic",
        (KYC, f.admin.clone()).into_val(&f.e),
    );

    f.topics.bind_vault(&f.clock.address);
    f.signed_once_by(
        &f.admin,
        "bind_vault",
        (f.clock.address.clone(),).into_val(&f.e),
    );
    f.topics.finish_setup();
    f.signed_once_by(&f.admin, "finish_setup", Vec::new(&f.e));

    let change = TopicsChange::AddClaimTopic(KYC);
    let id = f.topics.propose_change(&change);
    f.signed_once_by(&f.admin, "propose_change", (change.clone(),).into_val(&f.e));
    f.topics.cancel_change(&id);
    f.signed_once_by(&f.admin, "cancel_change", (id,).into_val(&f.e));

    let id = f.topics.propose_change(&change);
    f.e.ledger().with_mut(|l| l.timestamp += MIN_DELAY);
    f.topics.apply_change(&id);
    f.signed_once_by(&f.admin, "apply_change", (id,).into_val(&f.e));
}
