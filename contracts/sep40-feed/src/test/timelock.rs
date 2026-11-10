use soroban_sdk::{
    testutils::{Address as _, Events as _},
    Address, BytesN, Env, Event as _, IntoVal, Symbol,
};
use strata_timelock::{DAY_DURATION, MIN_DELAY};

use crate::{ChangeCancelled, ChangeProposed, FeedChange, FeedError, FeedPendingChange};

use super::{missing_auth, refused, setup};

fn hash(e: &Env, n: u8) -> BytesN<32> {
    BytesN::from_array(e, &[n; 32])
}

fn stranger(e: &Env) -> Address {
    Address::generate(e)
}

#[test]
fn an_upgrade_waits_for_the_vaults_delay() {
    let f = setup();
    let change = FeedChange::Upgrade(hash(&f.e, 7));
    let id = f.feed.propose_change(&change);

    assert_eq!(
        f.feed.pending_changes().get(0).unwrap(),
        FeedPendingChange {
            id,
            change,
            eta: 10_000 + MIN_DELAY,
        }
    );

    f.advance(MIN_DELAY - 1);
    refused(f.feed.try_apply_change(&id), FeedError::ChangeNotReady);
}

#[test]
fn a_vault_pause_holds_the_upgrade() {
    let f = setup();
    let id = f.feed.propose_change(&FeedChange::Upgrade(hash(&f.e, 7)));
    f.advance(MIN_DELAY);
    f.clock(|c| c.paused = true);

    refused(f.feed.try_apply_change(&id), FeedError::VaultPaused);

    f.clock(|c| {
        c.paused = false;
        c.paused_secs = 3 * DAY_DURATION;
    });

    assert_eq!(
        f.feed.pending_changes().get(0).unwrap().eta,
        10_000 + MIN_DELAY + 3 * DAY_DURATION
    );
    refused(f.feed.try_apply_change(&id), FeedError::ChangeNotReady);
}

#[test]
fn nothing_is_proposed_or_applied_while_the_vault_winds_down() {
    let f = setup();
    let id = f.feed.propose_change(&FeedChange::Upgrade(hash(&f.e, 7)));
    f.clock(|c| c.winding_down = true);
    f.advance(MIN_DELAY);

    refused(
        f.feed
            .try_propose_change(&FeedChange::Upgrade(hash(&f.e, 9))),
        FeedError::WindDownActive,
    );
    refused(f.feed.try_apply_change(&id), FeedError::WindDownActive);
    f.feed.cancel_change(&id);
}

#[test]
fn an_upgrade_shorter_than_a_raised_notice_never_lands() {
    let f = setup();
    f.clock(|c| c.delay = 30 * DAY_DURATION);
    let id = f.feed.propose_change(&FeedChange::Upgrade(hash(&f.e, 7)));
    f.clock(|c| c.exit_window = 31 * DAY_DURATION);
    f.advance(30 * DAY_DURATION);

    refused(f.feed.try_apply_change(&id), FeedError::DelayBelowNotice);
}

#[test]
fn one_upgrade_waits_at_a_time() {
    let f = setup();
    f.feed.propose_change(&FeedChange::Upgrade(hash(&f.e, 7)));

    refused(
        f.feed
            .try_propose_change(&FeedChange::Upgrade(hash(&f.e, 9))),
        FeedError::UpgradeAlreadyPending,
    );
}

#[test]
fn a_cancelled_upgrade_is_gone() {
    let f = setup();
    let id = f.feed.propose_change(&FeedChange::Upgrade(hash(&f.e, 7)));

    f.feed.cancel_change(&id);

    assert_eq!(f.feed.pending_changes().len(), 0);
    refused(f.feed.try_cancel_change(&id), FeedError::ChangeNotFound);
    refused(f.feed.try_apply_change(&id), FeedError::ChangeNotFound);
}

#[test]
fn only_the_vaults_governance_proposes_cancels_and_applies() {
    let f = setup();
    let stranger = stranger(&f.e);
    let change = FeedChange::Upgrade(hash(&f.e, 7));
    let id = f.feed.propose_change(&change);
    f.advance(MIN_DELAY);

    f.sign_only_as(
        &stranger,
        "propose_change",
        (change.clone(),).into_val(&f.e),
    );
    missing_auth(f.feed.try_propose_change(&change));
    f.sign_only_as(&stranger, "cancel_change", (id,).into_val(&f.e));
    missing_auth(f.feed.try_cancel_change(&id));
    f.sign_only_as(&stranger, "apply_change", (id,).into_val(&f.e));
    missing_auth(f.feed.try_apply_change(&id));
    assert_eq!(f.feed.pending_changes().len(), 1);
}

#[test]
fn each_change_call_asks_the_vaults_governance_for_one_signature() {
    let f = setup();
    let change = FeedChange::Upgrade(hash(&f.e, 7));

    let id = f.feed.propose_change(&change);
    f.signed_once_by(
        &f.governance,
        "propose_change",
        (change.clone(),).into_val(&f.e),
    );

    f.feed.cancel_change(&id);
    f.signed_once_by(&f.governance, "cancel_change", (id,).into_val(&f.e));
}

#[test]
fn the_feed_follows_a_governance_hand_over_on_the_vault() {
    let f = setup();
    let next = Address::generate(&f.e);
    let change = FeedChange::Upgrade(hash(&f.e, 7));
    let id = f.feed.propose_change(&change);

    f.vault.set_governance(&Some(next.clone()));

    f.sign_only_as(&f.governance, "cancel_change", (id,).into_val(&f.e));
    missing_auth(f.feed.try_cancel_change(&id));

    f.sign_only_as(&next, "cancel_change", (id,).into_val(&f.e));
    f.feed.cancel_change(&id);
    assert_eq!(f.feed.pending_changes().len(), 0);

    f.sign_only_as(&next, "propose_change", (change.clone(),).into_val(&f.e));
    let new_id = f.feed.propose_change(&change);
    assert_ne!(new_id, id);

    f.sign_only_as(&f.governance, "apply_change", (new_id,).into_val(&f.e));
    missing_auth(f.feed.try_apply_change(&new_id));

    f.sign_only_as(&next, "apply_change", (new_id,).into_val(&f.e));
    refused(f.feed.try_apply_change(&new_id), FeedError::ChangeNotReady);

    f.sign_only_as(
        &f.governance,
        "propose_change",
        (change.clone(),).into_val(&f.e),
    );
    missing_auth(f.feed.try_propose_change(&change));
}

#[test]
fn a_vault_that_names_no_governance_refuses_every_change() {
    let f = setup();
    let id = f.feed.propose_change(&FeedChange::Upgrade(hash(&f.e, 7)));
    f.vault.set_governance(&None);

    refused(
        f.feed
            .try_propose_change(&FeedChange::Upgrade(hash(&f.e, 9))),
        FeedError::NoGovernance,
    );
    refused(f.feed.try_cancel_change(&id), FeedError::NoGovernance);
    refused(f.feed.try_apply_change(&id), FeedError::NoGovernance);

    let f2 = setup();
    f2.vault.trap(&Symbol::new(&f2.e, "governance"));
    refused(
        f2.feed
            .try_propose_change(&FeedChange::Upgrade(hash(&f2.e, 7))),
        FeedError::NoGovernance,
    );
}

#[test]
fn proposing_and_cancelling_publish_the_change() {
    let f = setup();
    let change = FeedChange::Upgrade(hash(&f.e, 7));
    let eta = f.e.ledger().timestamp() + MIN_DELAY;

    let id = f.feed.propose_change(&change);
    assert_eq!(
        f.e.events().all().filter_by_contract(&f.feed.address),
        [ChangeProposed {
            id,
            change: change.clone(),
            eta,
        }
        .to_xdr(&f.e, &f.feed.address)]
    );

    f.feed.cancel_change(&id);
    assert_eq!(
        f.e.events().all().filter_by_contract(&f.feed.address),
        [ChangeCancelled { id }.to_xdr(&f.e, &f.feed.address)]
    );
}

#[test]
fn governance_calls_restore_the_instance_ttl() {
    let f = setup();
    let change = FeedChange::Upgrade(hash(&f.e, 7));

    let mut id = 0;
    f.restores_the_instance(|| id = f.feed.propose_change(&change));
    f.restores_the_instance(|| f.feed.cancel_change(&id));
}
