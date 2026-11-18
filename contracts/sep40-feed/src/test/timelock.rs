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

#[cfg(feature = "upgrade_wasm")]
mod with_wasm {
    use soroban_sdk::xdr::{ContractEventBody, ScError, ScErrorCode, ScErrorType, ScSymbol, ScVal};

    use sep40::PriceData;

    use crate::ChangeApplied;

    use super::super::{setup_with, PRICE};
    use super::*;

    mod feed_v1 {
        soroban_sdk::contractimport!(file = "../../target/wasm32v1-none/release/sep40_feed.wasm");
    }

    mod feed_probe {
        soroban_sdk::contractimport!(
            file = "../../target/upgrade-probe/wasm32v1-none/release/sep40_feed.wasm"
        );
    }

    /// What a caller sees when the host refuses a call: every host error is
    /// narrowed to this one.
    fn host_refusal() -> soroban_sdk::Error {
        soroban_sdk::Error::from_type_and_code(ScErrorType::Context, ScErrorCode::InvalidAction)
    }

    /// Whether the host refused a call to `function` because the contract
    /// exports no function of that name. The reason is only in the
    /// diagnostic events.
    fn exports_no(e: &Env, function: &str) -> bool {
        let missing = ScVal::Error(ScError::WasmVm(ScErrorCode::MissingValue));
        let name = ScVal::Symbol(ScSymbol(function.try_into().unwrap()));
        e.host()
            .get_diagnostic_events()
            .unwrap()
            .0
            .iter()
            .any(|event| {
                let ContractEventBody::V0(body) = &event.event.body;
                body.topics.contains(&missing)
                    && matches!(&body.data, ScVal::Vec(Some(args)) if args.contains(&name))
            })
    }

    #[test]
    fn the_feed_exposes_no_immediate_upgrade() {
        let f = setup_with(|e, args| e.register(feed_v1::WASM, args));
        let probe_hash = f.e.deployer().upload_contract_wasm(feed_probe::WASM);
        let upgrader =
            stellar_contract_utils::upgradeable::UpgradeableClient::new(&f.e, &f.feed.address);

        assert_eq!(
            upgrader.try_upgrade(&probe_hash, &f.governance),
            Err(Ok(host_refusal()))
        );
        assert!(exports_no(&f.e, "upgrade"));
        assert_eq!(
            feed_probe::Client::new(&f.e, &f.feed.address).try_probe(),
            Err(Ok(host_refusal()))
        );
        assert!(exports_no(&f.e, "probe"));
    }

    #[test]
    fn the_feed_upgrades_through_the_timelock_and_keeps_following_the_vault() {
        let f = setup_with(|e, args| e.register(feed_v1::WASM, args));
        let probe_hash = f.e.deployer().upload_contract_wasm(feed_probe::WASM);
        let change = FeedChange::Upgrade(probe_hash);
        let id = f.feed.propose_change(&change);

        let old_governance = f.governance.clone();
        let next = Address::generate(&f.e);
        f.vault.set_governance(&Some(next.clone()));
        f.advance(MIN_DELAY);

        f.sign_only_as(&old_governance, "apply_change", (id,).into_val(&f.e));
        missing_auth(f.feed.try_apply_change(&id));
        assert_eq!(f.feed.pending_changes().len(), 1);

        f.sign_only_as(&next, "apply_change", (id,).into_val(&f.e));
        f.feed.apply_change(&id);

        let events = f.e.events().all().filter_by_contract(&f.feed.address);
        assert_eq!(
            events.events().last(),
            Some(
                &ChangeApplied {
                    id,
                    change: change.clone(),
                }
                .to_xdr(&f.e, &f.feed.address)
            )
        );

        let probe = feed_probe::Client::new(&f.e, &f.feed.address);
        assert!(probe.probe());
        assert_eq!(f.feed.vault(), Some(f.vault.address.clone()));
        assert_eq!(
            f.feed.lastprice(&f.share_asset()),
            Some(PriceData {
                price: PRICE,
                timestamp: 10_000,
            })
        );
        assert_eq!(f.feed.pending_changes().len(), 0);
    }
}
