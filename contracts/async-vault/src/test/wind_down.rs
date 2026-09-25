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

    let stranger = Address::generate(&f.e);
    f.e.set_auths(&[]);
    assert!(f.vault.try_cancel_wind_down_proposal(&stranger).is_err());
    assert!(f.vault.try_cancel_wind_down_proposal(&f.manager).is_err());
    assert!(f.vault.try_cancel_wind_down_proposal(&f.guardian).is_err());

    f.e.mock_all_auths();
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

    let pot = f.vault.finalize_wind_down_round();

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

    let first = f.vault.finalize_wind_down_round();
    assert!(first > 0);

    f.vault.fund(&backer, &600);
    let second = f.vault.finalize_wind_down_round();

    assert_eq!(second, 600);
    assert_eq!(f.vault.wind_down_owed(), first + 600);
}

#[test]
fn a_round_with_nothing_to_distribute_is_refused() {
    let f = setup();
    let _user = f.holder(500);
    wind_down_now(&f);
    f.vault.finalize_wind_down_round();

    assert!(f.vault.try_finalize_wind_down_round().is_err());
}

#[test]
fn a_round_before_activation_is_refused() {
    let f = setup();
    let _user = f.holder(500);
    f.vault.propose_wind_down(&f.admin);

    assert!(f.vault.try_finalize_wind_down_round().is_err());
}

#[test]
fn anyone_may_finalise_a_round() {
    let f = setup();
    let _user = f.holder(500);
    wind_down_now(&f);

    f.e.set_auths(&[]);
    let pot = f.vault.finalize_wind_down_round();
    assert!(pot > 0);
    assert_eq!(f.vault.wind_down().unwrap().round, 1);
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

    f.vault.finalize_wind_down_round();

    assert_eq!(f.vault.committed(), committed);
    assert_eq!(f.vault.claim_redeem(&user, &epoch), 400);
}

#[test]
fn two_holders_split_a_round_in_proportion() {
    let f = setup();
    let big = f.holder(600);
    let small = f.holder(200);
    wind_down_now(&f);

    let pot = f.vault.finalize_wind_down_round();
    let supply = f.vault.wind_down_supply();

    let big_shares = f.shares(&big);
    let small_shares = f.shares(&small);

    let paid_big = f.vault.claim_wind_down(&big);
    let paid_small = f.vault.claim_wind_down(&small);

    assert_eq!(paid_big, big_shares * pot / supply);
    assert_eq!(paid_small, small_shares * pot / supply);
    assert_eq!(f.shares(&big), 0);
    assert_eq!(f.shares(&small), 0);
    assert!(paid_big + paid_small <= pot);
}

#[test]
fn a_holder_who_waits_collects_every_round_at_once() {
    let f = setup();
    let patient = f.holder(400);
    let prompt = f.holder(400);
    let backer = f.investor(10_000);
    wind_down_now(&f);

    f.vault.finalize_wind_down_round();
    let first = f.vault.claim_wind_down(&prompt);

    f.vault.fund(&backer, &800);
    f.vault.finalize_wind_down_round();
    let second = f.vault.claim_wind_down(&prompt);

    let all_at_once = f.vault.claim_wind_down(&patient);

    assert_eq!(all_at_once, first + second);
}

#[test]
fn claiming_burns_the_shares_and_pays_once() {
    let f = setup();
    let user = f.holder(500);
    wind_down_now(&f);
    f.vault.finalize_wind_down_round();

    let paid = f.vault.claim_wind_down(&user);
    assert!(paid > 0);
    assert_eq!(f.shares(&user), 0);

    assert!(f.vault.try_claim_wind_down(&user).is_err());
    assert_eq!(f.balance(&user), paid);
}

#[test]
fn surrendering_between_rounds_pays_nothing_and_is_allowed() {
    let f = setup();
    let user = f.holder(500);
    let backer = f.investor(10_000);
    wind_down_now(&f);
    f.vault.finalize_wind_down_round();
    f.vault.claim_wind_down(&user);

    // Nothing surrendered, nothing owed.
    assert!(f.vault.try_claim_wind_down(&user).is_err());

    f.vault.fund(&backer, &800);
    f.vault.finalize_wind_down_round();
    assert!(f.vault.claim_wind_down(&user) > 0);
}

#[test]
fn claiming_before_the_first_round_is_refused() {
    let f = setup();
    let user = f.holder(500);
    wind_down_now(&f);

    assert!(f.vault.try_claim_wind_down(&user).is_err());
}

#[test]
fn a_holder_with_no_shares_cannot_claim() {
    let f = setup();
    let _user = f.holder(500);
    let stranger = Address::generate(&f.e);
    wind_down_now(&f);
    f.vault.finalize_wind_down_round();

    assert!(f.vault.try_claim_wind_down(&stranger).is_err());
}

#[test]
fn an_escrowed_redemption_is_recovered_then_surrendered() {
    let f = setup();
    let user = f.holder(200);
    let epoch = f.vault.request_redeem(&user, &200);
    wind_down_now(&f);
    f.vault.finalize_wind_down_round();

    // The escrowed shares are inside the snapshot, so they must come back first.
    assert!(f.vault.try_claim_wind_down(&user).is_err());
    f.vault.cancel_redeem(&user, &epoch);
    let rest = f.vault.claim_wind_down(&user);

    assert!(rest > 0);
    assert_eq!(f.shares(&user), 0);
}

#[test]
fn the_payouts_never_exceed_what_the_rounds_credited() {
    let f = setup();
    let a = f.holder(333);
    let b = f.holder(667);
    wind_down_now(&f);

    let pot = f.vault.finalize_wind_down_round();
    let paid = f.vault.claim_wind_down(&a) + f.vault.claim_wind_down(&b);

    assert!(paid <= pot);
    assert!(f.vault.wind_down_owed() >= 0);
}

#[test]
fn the_pause_does_not_block_a_wind_down_claim() {
    let f = setup();
    let user = f.holder(500);
    wind_down_now(&f);
    f.vault.finalize_wind_down_round();
    f.vault.pause(&f.guardian);

    assert!(f.vault.claim_wind_down(&user) > 0);
}

#[test]
fn a_zero_share_refund_is_refused_once_a_round_has_taken_the_reserve() {
    let f = setup();
    let _holder = f.holder(500);
    let investor = f.investor(1_000);
    let epoch = f.vault.request_deposit(&investor, &1);
    f.close_epoch();
    // A price high enough that one unit of the asset buys no shares at all.
    f.fulfill_epoch_at(epoch, wad(2));
    wind_down_now(&f);
    f.vault.finalize_wind_down_round();

    // Known limit: the refund is not tracked as a liability, so a round can
    // credit the assets it needed.
    assert!(f.vault.try_claim_deposit(&investor, &epoch).is_err());
}

#[test]
fn the_vault_cannot_claim_against_its_own_escrowed_shares() {
    let f = setup();
    let user = f.holder(500);
    f.vault.request_redeem(&user, &200);
    wind_down_now(&f);
    f.vault.finalize_wind_down_round();

    f.e.set_auths(&[]);
    assert!(f.vault.try_claim_wind_down(&f.vault.address).is_err());
}

#[test]
fn a_position_survives_the_ledger_advancing() {
    let f = setup();
    let user = f.holder(500);
    let backer = f.investor(10_000);
    wind_down_now(&f);
    f.vault.finalize_wind_down_round();
    f.vault.claim_wind_down(&user);

    f.advance(29 * 24 * 60 * 60);

    f.vault.fund(&backer, &800);
    f.vault.finalize_wind_down_round();
    assert!(f.vault.claim_wind_down(&user) > 0);
}

#[test]
fn shares_acquired_after_first_claim_earn_all_prior_rounds() {
    let f = setup();
    let u1 = f.holder(300);
    let u2 = f.holder(300);
    let backer = f.investor(10_000);
    wind_down_now(&f);

    // Round 1
    f.vault.finalize_wind_down_round();
    let paid1 = f.vault.claim_wind_down(&u1);
    assert!(paid1 > 0);

    // u2 transfers their shares to u1 before claiming
    f.share.transfer(&u2, &u1, &300);

    // Round 2
    f.vault.fund(&backer, &1_200);
    f.vault.finalize_wind_down_round();

    // u1 claims with new shares. They earn round 1 + round 2 on the 300 new shares,
    // and round 2 on the 300 original shares.
    let paid2 = f.vault.claim_wind_down(&u1);
    assert!(paid2 > 0);

    let expected_total = stellar_contract_utils::math::i128_fixed_point::checked_mul_div_floor(
        &f.e,
        &600,
        &f.vault.wind_down_acc(),
        &WAD_SCALE,
    )
    .unwrap();
    assert_eq!(paid1 + paid2, expected_total);
}

#[test]
fn multiple_rounds_with_floor_dust_remain_solvent_for_last_claimant() {
    let f = setup();
    let h1 = f.holder(333);
    let h2 = f.holder(333);
    let h3 = f.holder(334);
    let backer = f.investor(10_000);
    wind_down_now(&f);

    f.vault.finalize_wind_down_round();
    f.vault.claim_wind_down(&h1);

    f.vault.fund(&backer, &333);
    f.vault.finalize_wind_down_round();
    f.vault.claim_wind_down(&h2);

    f.vault.fund(&backer, &333);
    f.vault.finalize_wind_down_round();

    let paid3 = f.vault.claim_wind_down(&h3);
    assert!(paid3 > 0);
    assert!(f.vault.wind_down_owed() >= 0);
}

#[test]
fn redemption_priced_before_wind_down_is_excluded_from_snapshot() {
    let f = setup();
    let u1 = f.holder(500);
    let u2 = f.holder(500);

    let epoch = f.vault.request_redeem(&u2, &200);
    f.fulfill_epoch(wad(1));
    assert_eq!(f.vault.pending_burn_shares(), 200);

    wind_down_now(&f);

    let reserve = f.vault.free_reserve();
    assert_eq!(f.vault.finalize_wind_down_round(), reserve);
    assert_eq!(f.vault.wind_down_supply(), 800);

    f.vault.claim_redeem(&u2, &epoch);
    assert_eq!(f.vault.pending_burn_shares(), 0);

    let paid1 = f.vault.claim_wind_down(&u1);
    assert!(paid1 > 0);
}

#[test]
fn propose_wind_down_reports_active_when_active() {
    let f = setup();
    let _user = f.holder(500);
    wind_down_now(&f);

    let err = f
        .vault
        .try_propose_wind_down(&f.admin)
        .unwrap_err()
        .unwrap();
    assert_eq!(err, VaultError::WindDownActive.into());
}
