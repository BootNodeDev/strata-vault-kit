use soroban_sdk::{testutils::Events as _, Event as _, IntoVal};
use stellar_contract_utils::pausable::PausableError;

use super::*;
use crate::{ChangeApplied, ChangeCancelled, ChangeProposed};

fn wasm(f: &Fixture, byte: u8) -> BytesN<32> {
    BytesN::from_array(&f.e, &[byte; 32])
}

fn propose(f: &Fixture, change: VaultChange) -> u32 {
    f.vault.propose_change(&change)
}

/// Raises the upgrade delay through the timelock, which costs one current delay.
fn raise_delay(f: &Fixture, secs: u64) {
    let id = propose(f, VaultChange::UpgradeDelay(secs));
    f.advance(f.vault.upgrade_delay());
    f.vault.apply_change(&id);
}

fn only_pending(f: &Fixture) -> VaultPendingChange {
    let pending = f.vault.pending_changes();
    assert_eq!(pending.len(), 1);
    pending.get(0).unwrap()
}

#[test]
fn the_delay_defaults_to_the_minimum() {
    let f = setup();

    assert_eq!(f.vault.upgrade_delay(), MIN_UPGRADE_DELAY);
}

#[test]
fn a_proposal_records_an_eta_one_delay_out() {
    let f = setup();
    let hash = wasm(&f, 7);

    let id = propose(&f, VaultChange::Upgrade(hash.clone()));

    let p = only_pending(&f);
    assert_eq!(p.id, id);
    assert_eq!(p.change, VaultChange::Upgrade(hash));
    assert_eq!(p.eta, f.e.ledger().timestamp() + MIN_UPGRADE_DELAY);
}

#[test]
fn a_second_code_change_while_one_stands_is_refused() {
    let f = setup();
    propose(&f, VaultChange::Upgrade(wasm(&f, 7)));

    refused(
        f.vault
            .try_propose_change(&VaultChange::Upgrade(wasm(&f, 9))),
        VaultError::UpgradeProposalExists,
    );
    refused(
        f.vault
            .try_propose_change(&VaultChange::UpgradeDelay(30 * DAY_DURATION)),
        VaultError::UpgradeProposalExists,
    );
}

#[test]
fn a_cancelled_proposal_leaves_the_slot_free() {
    let f = setup();
    let hash = wasm(&f, 7);
    let id = propose(&f, VaultChange::Upgrade(hash.clone()));

    f.vault.cancel_change(&id);
    assert_eq!(f.vault.pending_changes().len(), 0);

    propose(&f, VaultChange::Upgrade(hash));
    assert_eq!(f.vault.pending_changes().len(), 1);
}

#[test]
fn cancelling_nothing_is_refused() {
    let f = setup();

    refused(f.vault.try_cancel_change(&1), VaultError::ChangeNotFound);
}

#[test]
fn a_delay_below_the_minimum_is_refused() {
    let f = setup();

    refused(
        f.vault
            .try_propose_change(&VaultChange::UpgradeDelay(MIN_UPGRADE_DELAY - 1)),
        VaultError::UpgradeDelayTooShort,
    );
    assert_eq!(f.vault.pending_changes().len(), 0);
}

#[test]
fn a_delay_above_the_maximum_is_refused() {
    let f = setup();

    refused(
        f.vault
            .try_propose_change(&VaultChange::UpgradeDelay(MAX_UPGRADE_DELAY + 1)),
        VaultError::UpgradeDelayTooLong,
    );
    assert_eq!(f.vault.pending_changes().len(), 0);
}

#[test]
fn a_delay_below_the_standing_notice_is_refused() {
    let f = setup();
    raise_delay(&f, 30 * DAY_DURATION);

    f.vault.set_notice(&(20 * DAY_DURATION));

    // Above the minimum, below the notice: an exit could not complete.
    refused(
        f.vault
            .try_propose_change(&VaultChange::UpgradeDelay(10 * DAY_DURATION)),
        VaultError::UpgradeDelayBelowNotice,
    );

    propose(&f, VaultChange::UpgradeDelay(21 * DAY_DURATION));
    assert_eq!(f.vault.pending_changes().len(), 1);
}

#[test]
fn only_governance_proposes_and_cancels() {
    let f = setup();
    let change = VaultChange::Upgrade(wasm(&f, 7));
    let stranger = Address::generate(&f.e);

    // Any error: only the admin's own signature satisfies these calls, so a
    // mismatched signer traps in the host rather than naming an error.
    for who in [&stranger, &f.manager, &f.guardian] {
        f.sign_only_as(who, "propose_change", (change.clone(),).into_val(&f.e));
        assert!(f.vault.try_propose_change(&change).is_err());
    }
    let delay = VaultChange::UpgradeDelay(30 * DAY_DURATION);
    f.sign_only_as(
        &f.treasury,
        "propose_change",
        (delay.clone(),).into_val(&f.e),
    );
    assert!(f.vault.try_propose_change(&delay).is_err());

    f.e.mock_all_auths();
    let id = propose(&f, change);
    for who in [&stranger, &f.guardian] {
        f.sign_only_as(who, "cancel_change", (id,).into_val(&f.e));
        assert!(f.vault.try_cancel_change(&id).is_err());
    }
}

#[test]
fn the_schema_version_is_one_after_construction() {
    let f = setup();

    assert_eq!(f.vault.schema_version(), 1);
}

#[test]
fn applying_before_the_eta_is_refused() {
    let f = setup();
    let id = propose(&f, VaultChange::UpgradeDelay(30 * DAY_DURATION));

    refused(f.vault.try_apply_change(&id), VaultError::ChangeNotReady);

    f.advance(MIN_UPGRADE_DELAY - 1);
    refused(f.vault.try_apply_change(&id), VaultError::ChangeNotReady);

    f.advance(1);
    f.vault.apply_change(&id);
    assert_eq!(f.vault.upgrade_delay(), 30 * DAY_DURATION);
    assert_eq!(f.vault.pending_changes().len(), 0);
}

#[test]
fn changing_the_delay_serves_the_old_delay_first() {
    let f = setup();
    raise_delay(&f, 30 * DAY_DURATION);

    // The next proposal uses the new, longer delay.
    propose(&f, VaultChange::Upgrade(wasm(&f, 7)));
    assert_eq!(
        only_pending(&f).eta,
        f.e.ledger().timestamp() + 30 * DAY_DURATION
    );
}

#[test]
fn shortening_the_delay_cannot_be_rushed() {
    let f = setup();
    raise_delay(&f, 30 * DAY_DURATION);

    // Back down to the minimum: still costs the full thirty days.
    let id = propose(&f, VaultChange::UpgradeDelay(MIN_UPGRADE_DELAY));
    f.advance(30 * DAY_DURATION - 1);
    refused(f.vault.try_apply_change(&id), VaultError::ChangeNotReady);

    f.advance(1);
    f.vault.apply_change(&id);
    assert_eq!(f.vault.upgrade_delay(), MIN_UPGRADE_DELAY);
}

#[test]
fn the_notice_cannot_outgrow_the_delay() {
    let f = setup();
    propose(&f, VaultChange::UpgradeDelay(10 * DAY_DURATION));

    refused(
        f.vault.try_set_notice(&(20 * DAY_DURATION)),
        VaultError::NoticeAboveUpgradeDelay,
    );
    assert_eq!(f.vault.notice(), 0);
}

#[test]
fn applying_nothing_is_refused() {
    let f = setup();

    refused(f.vault.try_apply_change(&1), VaultError::ChangeNotFound);
}

#[test]
fn a_pause_freezes_the_upgrade_timelock_clock() {
    let f = setup();
    let id = propose(&f, VaultChange::UpgradeDelay(14 * DAY_DURATION));
    let original_eta = only_pending(&f).eta;

    f.advance(3 * DAY_DURATION);
    f.vault.pause(&f.guardian);
    f.advance(10 * DAY_DURATION);

    assert_eq!(
        f.vault.try_apply_change(&id),
        Err(Ok(PausableError::EnforcedPause.into()))
    );

    // Unpause: the eta has moved by the ten days spent paused.
    f.vault.unpause(&f.admin);
    assert_eq!(only_pending(&f).eta, original_eta + 10 * DAY_DURATION);

    // Six unpaused days out of seven: still refused.
    f.advance(3 * DAY_DURATION);
    refused(f.vault.try_apply_change(&id), VaultError::ChangeNotReady);

    f.advance(DAY_DURATION);
    f.vault.apply_change(&id);
    assert_eq!(f.vault.pending_changes().len(), 0);
    assert_eq!(f.vault.upgrade_delay(), 14 * DAY_DURATION);
}

#[test]
fn applying_while_paused_is_refused() {
    let f = setup();
    let id = propose(&f, VaultChange::UpgradeDelay(30 * DAY_DURATION));
    f.advance(MIN_UPGRADE_DELAY);

    // At the eta, with no paused time yet, only the pause stands in the way.
    f.vault.pause(&f.guardian);
    assert_eq!(
        f.vault.try_apply_change(&id),
        Err(Ok(PausableError::EnforcedPause.into()))
    );
    assert_eq!(f.vault.upgrade_delay(), MIN_UPGRADE_DELAY);

    f.vault.unpause(&f.admin);
    f.vault.apply_change(&id);
    assert_eq!(f.vault.upgrade_delay(), 30 * DAY_DURATION);
}

#[test]
fn only_governance_applies() {
    let f = setup();
    let stranger = Address::generate(&f.e);
    let id = propose(&f, VaultChange::UpgradeDelay(30 * DAY_DURATION));
    f.advance(MIN_UPGRADE_DELAY);

    // Any error: only the admin's own signature satisfies this call, so a
    // mismatched signer traps in the host rather than naming an error.
    for who in [&stranger, &f.manager, &f.guardian] {
        f.sign_only_as(who, "apply_change", (id,).into_val(&f.e));
        assert!(f.vault.try_apply_change(&id).is_err());
    }
    assert_eq!(f.vault.pending_changes().len(), 1);
}

/// Whether the host refused a call to `function` because the vault has no
/// function of that name. The reason is only in the diagnostic events.
fn has_no_function(e: &Env, function: &str) -> bool {
    use soroban_sdk::xdr::{ContractEventBody, ScError, ScErrorCode, ScSymbol, ScVal};
    let missing = ScVal::Error(ScError::Context(ScErrorCode::MissingValue));
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

/// What a caller sees when the host refuses a call: every host error is
/// narrowed to this one.
fn host_refusal() -> soroban_sdk::Error {
    use soroban_sdk::xdr::{ScErrorCode, ScErrorType};
    soroban_sdk::Error::from_type_and_code(ScErrorType::Context, ScErrorCode::InvalidAction)
}

#[test]
fn the_vault_exposes_no_immediate_upgrade() {
    let f = setup();
    let upgrader =
        stellar_contract_utils::upgradeable::UpgradeableClient::new(&f.e, &f.vault.address);

    assert_eq!(
        upgrader.try_upgrade(&wasm(&f, 7), &f.admin),
        Err(Ok(host_refusal()))
    );
    assert!(has_no_function(&f.e, "upgrade"));
}

#[test]
fn nothing_is_proposed_during_a_wind_down() {
    let f = setup();
    super::wind_down::wind_down_now(&f);

    refused(
        f.vault
            .try_propose_change(&VaultChange::Upgrade(wasm(&f, 7))),
        VaultError::WindDownActive,
    );
}

#[test]
fn a_change_standing_when_the_wind_down_starts_never_applies() {
    let f = setup();
    let id = propose(&f, VaultChange::Upgrade(wasm(&f, 7)));
    super::wind_down::wind_down_now(&f);
    f.advance(MAX_UPGRADE_DELAY);

    refused(f.vault.try_apply_change(&id), VaultError::WindDownActive);
    f.vault.cancel_change(&id);
    assert_eq!(f.vault.pending_changes().len(), 0);
}

#[test]
fn applying_a_delay_change_checks_the_notice_again() {
    let f = setup();
    raise_delay(&f, 30 * DAY_DURATION);
    let id = propose(&f, VaultChange::UpgradeDelay(MIN_UPGRADE_DELAY));

    // The notice rises while the shorter delay waits.
    f.vault.set_notice(&(20 * DAY_DURATION));
    f.advance(30 * DAY_DURATION);

    refused(
        f.vault.try_apply_change(&id),
        VaultError::UpgradeDelayBelowNotice,
    );
    assert_eq!(f.vault.upgrade_delay(), 30 * DAY_DURATION);
}

#[test]
fn proposing_and_applying_publish_the_change() {
    let f = setup();
    let change = VaultChange::UpgradeDelay(30 * DAY_DURATION);
    let eta = f.e.ledger().timestamp() + MIN_UPGRADE_DELAY;

    let id = propose(&f, change.clone());
    assert_eq!(
        f.e.events().all().filter_by_contract(&f.vault.address),
        [ChangeProposed {
            id,
            change: change.clone(),
            eta,
        }
        .to_xdr(&f.e, &f.vault.address)]
    );

    f.advance(MIN_UPGRADE_DELAY);
    f.vault.apply_change(&id);
    assert_eq!(
        f.e.events().all().filter_by_contract(&f.vault.address),
        [ChangeApplied { id, change }.to_xdr(&f.e, &f.vault.address)]
    );
}

#[test]
fn cancelling_publishes_the_change_id() {
    let f = setup();
    let id = propose(&f, VaultChange::Upgrade(wasm(&f, 7)));

    f.vault.cancel_change(&id);

    assert_eq!(
        f.e.events().all().filter_by_contract(&f.vault.address),
        [ChangeCancelled { id }.to_xdr(&f.e, &f.vault.address)]
    );
}

#[test]
fn the_vault_reports_its_clock_to_the_token_and_the_oracle() {
    let f = setup();
    f.vault.pause(&f.guardian);
    f.advance(DAY_DURATION);

    let clock = strata_timelock::ClockSourceClient::new(&f.e, &f.vault.address).timelock_clock();

    assert_eq!(
        clock,
        strata_timelock::Clock {
            delay: MIN_UPGRADE_DELAY,
            exit_window: 0,
            paused_secs: DAY_DURATION,
            paused: true,
            winding_down: false,
        }
    );
}

#[cfg(feature = "upgrade_wasm")]
mod with_wasm {
    use share_token::TokenChange;
    use soroban_sdk::xdr::{ContractEventBody, ScError, ScErrorCode, ScSymbol, ScVal};

    use super::*;

    mod token_v1 {
        soroban_sdk::contractimport!(file = "../../target/wasm32v1-none/release/share_token.wasm");
    }

    mod token_probe {
        soroban_sdk::contractimport!(
            file = "../../target/upgrade-probe/wasm32v1-none/release/share_token.wasm"
        );
    }

    mod vault_probe {
        soroban_sdk::contractimport!(
            file = "../../target/upgrade-probe/wasm32v1-none/release/async_vault.wasm"
        );
    }

    /// Upgrades the vault to its probe build.
    fn upgrade_to_probe<'a>(f: &'a Fixture) -> vault_probe::Client<'a> {
        let hash = f.e.deployer().upload_contract_wasm(vault_probe::WASM);
        let id = f.vault.propose_change(&VaultChange::Upgrade(hash));
        f.advance(MIN_UPGRADE_DELAY);
        f.vault.apply_change(&id);
        vault_probe::Client::new(&f.e, &f.vault.address)
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
    fn the_token_exposes_no_immediate_upgrade() {
        let f = setup_with(open_feed(), |e, args| e.register(token_v1::WASM, args));
        let probe_hash = f.e.deployer().upload_contract_wasm(token_probe::WASM);
        let upgrader =
            stellar_contract_utils::upgradeable::UpgradeableClient::new(&f.e, &f.share.address);

        assert_eq!(
            upgrader.try_upgrade(&probe_hash, &f.admin),
            Err(Ok(host_refusal()))
        );
        assert!(exports_no(&f.e, "upgrade"));
        assert_eq!(
            token_probe::Client::new(&f.e, &f.share.address).try_probe(),
            Err(Ok(host_refusal()))
        );
        assert!(exports_no(&f.e, "probe"));
        assert_eq!(f.share.schema_version(), 1);
    }

    #[test]
    fn the_token_upgrades_under_live_balances_and_open_requests() {
        let f = setup_with(open_feed(), |e, args| e.register(token_v1::WASM, args));
        let holder = f.holder(100);
        let other = f.investor(1);
        let epoch = f.vault.request_redeem(&holder, &40);
        let depositor = f.investor(500);
        assert_eq!(f.vault.request_deposit(&depositor, &500), epoch);

        let probe_hash = f.e.deployer().upload_contract_wasm(token_probe::WASM);
        let id = f.share.propose_change(&TokenChange::Upgrade(probe_hash));
        f.advance(MIN_UPGRADE_DELAY);
        f.share.apply_change(&id);

        let probe = token_probe::Client::new(&f.e, &f.share.address);
        assert!(probe.probe());
        assert_eq!(probe.schema_version(), 1);
        probe.migrate();
        assert_eq!(probe.schema_version(), 2);
        assert_eq!(
            probe.try_migrate(),
            Err(Ok(token_probe::ProbeError::AlreadyMigrated.into()))
        );

        assert_eq!(f.shares(&holder), 60);
        assert_eq!(f.shares(&f.vault.address), 40);
        assert_eq!(
            f.vault.get_redeem_request(&epoch, &holder).unwrap().shares,
            40
        );

        f.fulfill_epoch_at(f.close_epoch(), wad(2));
        assert_eq!(f.vault.claim_redeem(&holder, &epoch), 80);
        assert_eq!(f.vault.claim_deposit(&depositor, &epoch), 250);
        assert_eq!(f.shares(&depositor), 250);
        assert_eq!(f.shares(&f.vault.address), 0);

        f.share.transfer(&holder, &other, &10);
        assert_eq!(f.shares(&other), 10);
    }

    #[test]
    fn applying_a_wasm_change_replaces_the_code() {
        let f = setup();

        let probe = upgrade_to_probe(&f);
        assert!(probe.probe());
        assert_eq!(probe.schema_version(), 1);

        probe.migrate();
        assert_eq!(probe.schema_version(), 2);

        assert_eq!(
            probe.try_migrate(),
            Err(Ok(vault_probe::ProbeError::AlreadyMigrated.into()))
        );
        assert_eq!(probe.schema_version(), 2);
    }

    #[test]
    fn the_vault_upgrades_under_open_requests_and_a_proposed_wind_down() {
        let f = setup();
        let staying = f.holder(500);
        let exiting = f.holder(300);
        let priced = f.vault.request_redeem(&exiting, &100);
        f.fulfill_epoch(wad(2));
        let depositor = f.investor(400);
        let open = f.vault.request_deposit(&depositor, &400);
        let successor = Address::generate(&f.e);
        let queued = f
            .vault
            .propose_change(&VaultChange::Custodian(successor.clone()));
        f.vault.propose_wind_down();
        let kept = (
            f.vault.get_epoch(&open),
            f.vault.get_deposit_request(&open, &depositor),
            f.vault.get_epoch(&priced),
            f.vault.get_redeem_request(&priced, &exiting),
            f.vault.committed(),
            f.vault.wind_down(),
            f.vault.pending_changes(),
        );

        let probe = upgrade_to_probe(&f);
        assert!(probe.probe());
        probe.migrate();
        assert_eq!(probe.schema_version(), 2);
        assert_eq!(
            (
                f.vault.get_epoch(&open),
                f.vault.get_deposit_request(&open, &depositor),
                f.vault.get_epoch(&priced),
                f.vault.get_redeem_request(&priced, &exiting),
                f.vault.committed(),
                f.vault.wind_down(),
                f.vault.pending_changes(),
            ),
            kept
        );

        assert_eq!(f.vault.claim_redeem(&exiting, &priced), 200);
        f.vault.apply_change(&queued);
        assert_eq!(f.vault.custodian(), Some(successor));
        assert_eq!(f.close_epoch(), open);
        f.fulfill_epoch_at(open, wad(2));
        assert_eq!(f.vault.claim_deposit(&depositor, &open), 200);
        f.vault.activate_wind_down();
        assert_eq!(f.vault.finalize_wind_down_round(), 1_800);
        assert_eq!(f.vault.wind_down_supply(), 900);
        assert_eq!(f.vault.claim_wind_down(&staying), 1_000);
    }
}
