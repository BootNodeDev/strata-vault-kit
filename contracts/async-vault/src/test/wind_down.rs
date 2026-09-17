use super::*;

#[test]
fn governance_sets_the_delay_within_the_maximum() {
    let f = setup();

    assert_eq!(f.vault.wind_down_delay(), 0);

    f.vault.set_wind_down_delay(&(7 * 24 * 60 * 60), &f.admin);
    assert_eq!(f.vault.wind_down_delay(), 7 * 24 * 60 * 60);
}

#[test]
fn the_delay_cannot_exceed_the_maximum() {
    let f = setup();

    assert!(f
        .vault
        .try_set_wind_down_delay(&(MAX_WIND_DOWN_DELAY + 1), &f.admin)
        .is_err());
    assert_eq!(f.vault.wind_down_delay(), 0);
}

#[test]
fn only_governance_sets_the_delay() {
    let f = setup();
    let stranger = Address::generate(&f.e);

    f.e.set_auths(&[]);
    assert!(f.vault.try_set_wind_down_delay(&60, &stranger).is_err());
    assert!(f.vault.try_set_wind_down_delay(&60, &f.manager).is_err());
    assert!(f.vault.try_set_wind_down_delay(&60, &f.treasury).is_err());
    assert!(f.vault.try_set_wind_down_delay(&60, &f.guardian).is_err());
    assert_eq!(f.vault.wind_down_delay(), 0);
}

#[test]
fn a_fresh_vault_is_not_winding_down() {
    let f = setup();

    assert_eq!(f.vault.wind_down(), None);
}

const WEEK: u64 = 7 * 24 * 60 * 60;

#[test]
fn governance_proposes_and_anyone_activates_after_the_delay() {
    let f = setup();
    let stranger = Address::generate(&f.e);
    f.vault.set_wind_down_delay(&WEEK, &f.admin);

    f.vault.propose_wind_down(&f.admin);
    let proposed = f.vault.wind_down().unwrap();
    assert_eq!(proposed.status, WindDownStatus::Proposed);
    assert_eq!(proposed.round, 0);

    assert!(f.vault.try_activate_wind_down().is_err());

    f.advance(WEEK);
    f.vault.activate_wind_down();

    assert_eq!(f.vault.wind_down().unwrap().status, WindDownStatus::Active);
    let _ = stranger;
}

#[test]
fn activation_is_open_to_a_stranger() {
    let f = setup();
    f.vault.set_wind_down_delay(&WEEK, &f.admin);
    f.vault.propose_wind_down(&f.admin);
    f.advance(WEEK);

    f.e.set_auths(&[]);
    f.vault.activate_wind_down();

    assert_eq!(f.vault.wind_down().unwrap().status, WindDownStatus::Active);
}

#[test]
fn only_governance_proposes() {
    let f = setup();
    let stranger = Address::generate(&f.e);

    f.e.set_auths(&[]);
    assert!(f.vault.try_propose_wind_down(&stranger).is_err());
    assert!(f.vault.try_propose_wind_down(&f.manager).is_err());
    assert!(f.vault.try_propose_wind_down(&f.guardian).is_err());
    assert_eq!(f.vault.wind_down(), None);
}

#[test]
fn a_second_proposal_cannot_push_the_date_back() {
    let f = setup();
    f.vault.set_wind_down_delay(&WEEK, &f.admin);
    f.vault.propose_wind_down(&f.admin);
    let first = f.vault.wind_down().unwrap().active_at;

    f.advance(WEEK / 2);
    assert!(f.vault.try_propose_wind_down(&f.admin).is_err());

    assert_eq!(f.vault.wind_down().unwrap().active_at, first);
}

#[test]
fn governance_cancels_a_proposal_before_activation() {
    let f = setup();
    f.vault.set_wind_down_delay(&WEEK, &f.admin);
    f.vault.propose_wind_down(&f.admin);

    f.vault.cancel_wind_down_proposal(&f.admin);
    assert_eq!(f.vault.wind_down(), None);

    f.vault.propose_wind_down(&f.admin);
    assert_eq!(
        f.vault.wind_down().unwrap().status,
        WindDownStatus::Proposed
    );
}

#[test]
fn an_active_wind_down_cannot_be_cancelled() {
    let f = setup();
    f.vault.set_wind_down_delay(&WEEK, &f.admin);
    f.vault.propose_wind_down(&f.admin);
    f.advance(WEEK);
    f.vault.activate_wind_down();

    assert!(f.vault.try_cancel_wind_down_proposal(&f.admin).is_err());
    assert_eq!(f.vault.wind_down().unwrap().status, WindDownStatus::Active);
}

#[test]
fn activating_without_a_proposal_is_refused() {
    let f = setup();

    assert!(f.vault.try_activate_wind_down().is_err());
}

#[test]
fn a_zero_delay_activates_immediately() {
    let f = setup();

    f.vault.propose_wind_down(&f.admin);
    f.vault.activate_wind_down();

    assert_eq!(f.vault.wind_down().unwrap().status, WindDownStatus::Active);
}

/// Proposes, waits and activates. Returns nothing; the vault is active after.
fn wind_down_now(f: &Fixture) {
    f.vault.propose_wind_down(&f.admin);
    f.vault.activate_wind_down();
}

#[test]
fn an_active_wind_down_takes_no_new_requests() {
    let f = setup();
    let investor = f.investor(1_000);
    let holder = f.holder(500);
    wind_down_now(&f);

    assert!(f.vault.try_request_deposit(&investor, &100).is_err());
    assert!(f.vault.try_request_redeem(&holder, &100).is_err());
}

#[test]
fn an_active_wind_down_prices_nothing_and_closes_no_epoch() {
    let f = setup();
    let investor = f.investor(1_000);
    f.vault.request_deposit(&investor, &400);
    let epoch = f.close_epoch();
    wind_down_now(&f);

    f.attest(wad(2));
    assert!(f.vault.try_fulfill_epoch(&epoch).is_err());
    assert!(f.vault.try_close_epoch(&f.manager).is_err());
}

#[test]
fn an_active_wind_down_sends_nothing_to_the_custodian() {
    let f = setup();
    f.vault.set_custodian(&f.custodian, &f.admin);
    let investor = f.investor(1_000);
    f.vault.request_deposit(&investor, &400);
    f.fulfill_epoch(wad(2));
    wind_down_now(&f);

    assert!(f.vault.try_deploy_to_custodian(&f.treasury, &100).is_err());
}

#[test]
fn funding_stays_open_during_a_wind_down() {
    let f = setup();
    f.vault.set_custodian(&f.custodian, &f.admin);
    let backer = f.investor(1_000);
    wind_down_now(&f);

    f.vault.fund(&backer, &500);
    assert_eq!(f.balance(&f.vault.address), 500);
}

#[test]
fn a_priced_claim_still_pays_during_a_wind_down() {
    let f = setup();
    let user = f.holder(500);
    let epoch = f.vault.request_redeem(&user, &200);
    f.fulfill_epoch(wad(2));
    wind_down_now(&f);

    assert_eq!(f.vault.claim_redeem(&user, &epoch), 400);
}

#[test]
fn a_priced_deposit_still_claims_during_a_wind_down() {
    let f = setup();
    let user = f.investor(1_000);
    let epoch = f.vault.request_deposit(&user, &400);
    f.fulfill_epoch(wad(2));
    wind_down_now(&f);

    assert_eq!(f.vault.claim_deposit(&user, &epoch), 200);
    assert_eq!(f.shares(&user), 200);
}

#[test]
fn an_epoch_sealed_before_the_announcement_is_still_cancellable() {
    let f = setup();
    let investor = f.investor(1_000);
    let epoch = f.vault.request_deposit(&investor, &400);
    f.close_epoch();
    f.attest(wad(2));

    // The price is readable, so without a wind-down this cancel is refused.
    assert!(f.vault.try_cancel_deposit(&investor, &epoch).is_err());

    wind_down_now(&f);

    assert_eq!(f.vault.cancel_deposit(&investor, &epoch), 400);
    assert_eq!(f.balance(&investor), 1_000);
}

#[test]
fn an_escrowed_redemption_is_still_cancellable_after_the_announcement() {
    let f = setup();
    let user = f.holder(500);
    let epoch = f.vault.request_redeem(&user, &200);
    f.close_epoch();
    f.attest(wad(2));
    wind_down_now(&f);

    assert_eq!(f.vault.cancel_redeem(&user, &epoch), 200);
    assert_eq!(f.shares(&user), 500);
}

#[test]
fn the_first_round_snapshots_supply_and_credits_the_free_reserve() {
    let f = setup();
    let user = f.holder(500);
    wind_down_now(&f);

    let reserve = f.vault.free_reserve();
    assert!(reserve > 0);

    let pot = f.vault.finalize_wind_down_round(&f.admin);

    assert_eq!(pot, reserve);
    assert_eq!(f.vault.wind_down_supply(), f.shares(&user));
    assert_eq!(f.vault.wind_down().unwrap().round, 1);
    assert_eq!(f.vault.wind_down_owed(), pot);
    assert_eq!(f.vault.free_reserve(), 0);
}

#[test]
fn a_second_round_does_not_credit_the_first_round_again() {
    let f = setup();
    let _user = f.holder(500);
    let backer = f.investor(1_000);
    wind_down_now(&f);

    let first = f.vault.finalize_wind_down_round(&f.admin);
    assert!(first > 0);

    f.vault.fund(&backer, &600);
    let second = f.vault.finalize_wind_down_round(&f.admin);

    assert_eq!(second, 600);
    assert_eq!(f.vault.wind_down_owed(), first + 600);
}

#[test]
fn a_round_with_nothing_to_distribute_is_refused() {
    let f = setup();
    let _user = f.holder(500);
    wind_down_now(&f);
    f.vault.finalize_wind_down_round(&f.admin);

    assert!(f.vault.try_finalize_wind_down_round(&f.admin).is_err());
}

#[test]
fn a_round_before_activation_is_refused() {
    let f = setup();
    let _user = f.holder(500);
    f.vault.propose_wind_down(&f.admin);

    assert!(f.vault.try_finalize_wind_down_round(&f.admin).is_err());
}

#[test]
fn only_governance_finalises_a_round() {
    let f = setup();
    let _user = f.holder(500);
    let stranger = Address::generate(&f.e);
    wind_down_now(&f);

    f.e.set_auths(&[]);
    assert!(f.vault.try_finalize_wind_down_round(&stranger).is_err());
    assert!(f.vault.try_finalize_wind_down_round(&f.manager).is_err());
    assert!(f.vault.try_finalize_wind_down_round(&f.treasury).is_err());
    assert_eq!(f.vault.wind_down().unwrap().round, 0);
}

#[test]
fn a_round_leaves_priced_liabilities_alone() {
    let f = setup();
    let user = f.holder(500);
    let epoch = f.vault.request_redeem(&user, &200);
    f.fulfill_epoch(wad(2));
    let committed = f.vault.committed();
    assert_eq!(committed, 400);
    wind_down_now(&f);

    f.vault.finalize_wind_down_round(&f.admin);

    assert_eq!(f.vault.committed(), committed);
    assert_eq!(f.vault.claim_redeem(&user, &epoch), 400);
}
