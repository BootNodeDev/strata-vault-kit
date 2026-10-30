use proptest::prelude::*;
use soroban_sdk::{contract, contracterror, contractimpl, panic_with_error, IntoVal};

use super::*;

#[test]
fn governance_sets_the_delay_within_the_maximum() {
    let f = setup();

    assert_eq!(f.vault.wind_down_delay(), MIN_WIND_DOWN_DELAY);

    f.vault.set_wind_down_delay(&(14 * DAY_DURATION));
    assert_eq!(f.vault.wind_down_delay(), 14 * DAY_DURATION);
}

#[test]
fn the_delay_cannot_exceed_the_maximum() {
    let f = setup();

    refused(
        f.vault.try_set_wind_down_delay(&(MAX_WIND_DOWN_DELAY + 1)),
        VaultError::WindDownDelayTooLong,
    );
    assert_eq!(f.vault.wind_down_delay(), MIN_WIND_DOWN_DELAY);
}

#[test]
fn only_governance_sets_the_delay() {
    let f = setup();
    let stranger = Address::generate(&f.e);
    let longer = 2 * MIN_WIND_DOWN_DELAY;

    for who in [&stranger, &f.manager, &f.treasury, &f.guardian] {
        f.sign_only_as(who, "set_wind_down_delay", (longer,).into_val(&f.e));
        missing_auth(f.vault.try_set_wind_down_delay(&longer));
    }
    assert_eq!(f.vault.wind_down_delay(), MIN_WIND_DOWN_DELAY);
}

#[test]
fn a_fresh_vault_is_not_winding_down() {
    let f = setup();

    assert_eq!(f.vault.wind_down(), None);
}

#[test]
fn governance_proposes_and_anyone_activates_after_the_delay() {
    let f = setup();
    let delay = 2 * MIN_WIND_DOWN_DELAY;
    f.vault.set_wind_down_delay(&delay);

    f.vault.propose_wind_down();
    let proposed = f.vault.wind_down().unwrap();
    assert_eq!(proposed.status, WindDownStatus::Proposed);
    assert_eq!(proposed.round, 0);
    assert_eq!(proposed.active_at, f.e.ledger().timestamp() + delay);

    f.advance(delay - 1);
    refused(
        f.vault.try_activate_wind_down(),
        VaultError::WindDownDelayNotElapsed,
    );

    f.advance(1);
    f.e.set_auths(&[]);
    f.vault.activate_wind_down();
    assert_eq!(f.vault.wind_down().unwrap().status, WindDownStatus::Active);
}

#[test]
fn only_governance_proposes() {
    let f = setup();
    let stranger = Address::generate(&f.e);

    for who in [&stranger, &f.manager, &f.guardian] {
        f.sign_only_as(who, "propose_wind_down", soroban_sdk::Vec::new(&f.e));
        missing_auth(f.vault.try_propose_wind_down());
    }
    assert_eq!(f.vault.wind_down(), None);
}

#[test]
fn a_second_proposal_cannot_push_the_date_back() {
    let f = setup();
    f.vault.propose_wind_down();
    let first = f.vault.wind_down().unwrap().active_at;

    f.advance(MIN_WIND_DOWN_DELAY / 2);
    refused(
        f.vault.try_propose_wind_down(),
        VaultError::WindDownAlreadyProposed,
    );

    assert_eq!(f.vault.wind_down().unwrap().active_at, first);
}

#[test]
fn governance_cancels_a_proposal_before_activation() {
    let f = setup();
    f.vault.propose_wind_down();

    let stranger = Address::generate(&f.e);
    for who in [&stranger, &f.manager, &f.guardian] {
        f.sign_only_as(
            who,
            "cancel_wind_down_proposal",
            soroban_sdk::Vec::new(&f.e),
        );
        missing_auth(f.vault.try_cancel_wind_down_proposal());
    }

    f.e.mock_all_auths();
    f.vault.cancel_wind_down_proposal();
    assert_eq!(f.vault.wind_down(), None);

    f.vault.propose_wind_down();
    assert_eq!(
        f.vault.wind_down().unwrap().status,
        WindDownStatus::Proposed
    );
}

#[test]
fn an_active_wind_down_cannot_be_cancelled() {
    let f = setup();
    wind_down_now(&f);

    refused(
        f.vault.try_cancel_wind_down_proposal(),
        VaultError::WindDownActive,
    );
    assert_eq!(f.vault.wind_down().unwrap().status, WindDownStatus::Active);
}

#[test]
fn activating_without_a_proposal_is_refused() {
    let f = setup();

    refused(
        f.vault.try_activate_wind_down(),
        VaultError::WindDownNotProposed,
    );
}

#[test]
fn a_delay_below_the_minimum_is_refused() {
    for f in [setup_unfinished(), setup()] {
        refused(
            f.vault.try_set_wind_down_delay(&(MIN_WIND_DOWN_DELAY - 1)),
            VaultError::WindDownDelayTooShort,
        );
    }
}

/// Proposes, waits and activates. Returns nothing; the vault is active after.
pub(super) fn wind_down_now(f: &Fixture) {
    f.vault.propose_wind_down();
    f.advance(MIN_WIND_DOWN_DELAY);
    f.vault.activate_wind_down();
}

/// Winds down and finalises the first round; returns what it credited.
pub(super) fn first_round_now(f: &Fixture) -> i128 {
    wind_down_now(f);
    f.vault.finalize_wind_down_round()
}

#[test]
fn an_active_wind_down_takes_no_new_requests() {
    let f = setup();
    let investor = f.investor(1_000);
    let holder = f.holder(500);
    wind_down_now(&f);

    refused(
        f.vault.try_request_deposit(&investor, &100),
        VaultError::WindDownActive,
    );
    refused(
        f.vault.try_request_redeem(&holder, &100),
        VaultError::WindDownActive,
    );
}

#[test]
fn a_proposed_wind_down_takes_no_new_deposit() {
    let f = setup();
    let holder = f.holder(500);
    let early = f.investor(1_000);
    let epoch = f.vault.request_deposit(&early, &100);
    let late = f.investor(1_000);
    f.vault.propose_wind_down();

    refused(
        f.vault.try_request_deposit(&late, &100),
        VaultError::WindDownAlreadyProposed,
    );
    f.vault.request_redeem(&holder, &100);
    assert_eq!(f.vault.cancel_deposit(&early, &epoch), 100);
}

#[test]
fn cancelling_the_proposal_reopens_deposits() {
    let f = setup();
    let investor = f.investor(1_000);
    f.vault.propose_wind_down();
    f.vault.cancel_wind_down_proposal();

    f.vault.request_deposit(&investor, &100);
}

#[test]
fn an_active_wind_down_prices_nothing_and_closes_no_epoch() {
    let f = setup();
    let investor = f.investor(1_000);
    f.vault.request_deposit(&investor, &400);
    let epoch = f.close_epoch();
    wind_down_now(&f);

    f.attest(wad(2));
    refused(
        f.vault.try_fulfill_epoch(&epoch),
        VaultError::WindDownActive,
    );
    refused(
        f.vault.try_close_epoch(&f.manager),
        VaultError::WindDownActive,
    );
}

#[test]
fn an_active_wind_down_sends_nothing_to_the_custodian() {
    let f = setup();
    let investor = f.investor(1_000);
    f.vault.request_deposit(&investor, &400);
    f.fulfill_epoch(wad(2));
    wind_down_now(&f);

    refused(
        f.vault.try_deploy_to_custodian(&f.treasury, &100),
        VaultError::WindDownActive,
    );
}

#[test]
fn funding_stays_open_during_a_wind_down() {
    let f = setup();
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
    refused(
        f.vault.try_cancel_deposit(&investor, &epoch),
        VaultError::PriceAvailable,
    );

    wind_down_now(&f);

    assert_eq!(f.vault.cancel_deposit(&investor, &epoch), 400);
    assert_eq!(f.balance(&investor), 1_000);
}

#[test]
fn an_escrowed_redemption_cancelled_in_a_wind_down_joins_the_payout() {
    let f = setup();
    let user = f.holder(500);
    let epoch = f.vault.request_redeem(&user, &200);
    f.close_epoch();
    f.attest(wad(2));
    wind_down_now(&f);

    assert_eq!(f.vault.cancel_redeem(&user, &epoch), 200);
    assert_eq!(f.shares(&user), 300);

    let pot = f.vault.finalize_wind_down_round();
    assert_eq!(f.vault.claim_wind_down(&user), pot);
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
    let first = first_round_now(&f);
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
    first_round_now(&f);

    refused(
        f.vault.try_finalize_wind_down_round(),
        VaultError::NothingToDistribute,
    );
}

#[test]
fn a_round_before_activation_is_refused() {
    let f = setup();
    let _user = f.holder(500);
    f.vault.propose_wind_down();

    refused(
        f.vault.try_finalize_wind_down_round(),
        VaultError::WindDownNotActive,
    );
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
    first_round_now(&f);

    assert_eq!(f.vault.committed(), committed);
    assert_eq!(f.vault.claim_redeem(&user, &epoch), 400);
}

#[test]
fn two_holders_split_a_round_in_proportion() {
    let f = setup();
    let big = f.holder(600);
    let small = f.holder(200);
    let pot = first_round_now(&f);
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
    first_round_now(&f);
    let first = f.vault.claim_wind_down(&prompt);

    f.vault.fund(&backer, &800);
    f.vault.finalize_wind_down_round();
    let second = f.vault.claim_wind_down(&prompt);

    let all_at_once = f.vault.claim_wind_down(&patient);

    assert_eq!(all_at_once, first + second);
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
enum ModuleError {
    BurnRefused = 1,
}

#[contract]
struct FailsEveryBurn;

#[contractimpl]
impl FailsEveryBurn {
    pub fn on_destroyed(e: Env, _from: Address, _amount: i128, _token: Address) {
        panic_with_error!(&e, ModuleError::BurnRefused);
    }
}

#[test]
fn a_module_failing_on_burn_blocks_wind_down_claims_and_cannot_be_removed() {
    let f = setup();
    let holder = f.holder(500);
    let module = f.e.register(FailsEveryBurn, ());
    f.add_compliance_module(ComplianceHook::Destroyed, &module);
    first_round_now(&f);

    assert_eq!(
        f.vault.try_claim_wind_down(&holder),
        Err(Ok(ModuleError::BurnRefused.into()))
    );
    assert_eq!(f.shares(&holder), 500);
    assert_eq!(f.balance(&holder), 0);

    let rules = ComplianceClient::new(&f.e, &f.share.compliance());
    assert_eq!(
        rules.try_propose_change(&ComplianceChange::RemoveModule(
            ComplianceHook::Destroyed,
            module,
        )),
        Err(Ok(
            ::compliance::ComplianceContractError::WindDownActive.into()
        ))
    );
}

#[test]
fn claiming_burns_the_shares_and_pays_once() {
    let f = setup();
    let user = f.holder(500);
    first_round_now(&f);

    let paid = f.vault.claim_wind_down(&user);
    assert!(paid > 0);
    assert_eq!(f.shares(&user), 0);

    refused(
        f.vault.try_claim_wind_down(&user),
        VaultError::NoEntitlement,
    );
    assert_eq!(f.balance(&user), paid);
}

#[test]
fn surrendering_between_rounds_pays_nothing_and_is_allowed() {
    let f = setup();
    let user = f.holder(500);
    let backer = f.investor(10_000);
    first_round_now(&f);
    f.vault.claim_wind_down(&user);

    // Nothing surrendered, nothing owed.
    refused(
        f.vault.try_claim_wind_down(&user),
        VaultError::NoEntitlement,
    );

    f.vault.fund(&backer, &800);
    f.vault.finalize_wind_down_round();
    assert!(f.vault.claim_wind_down(&user) > 0);
}

#[test]
fn claiming_before_the_first_round_is_refused() {
    let f = setup();
    let user = f.holder(500);
    wind_down_now(&f);

    refused(
        f.vault.try_claim_wind_down(&user),
        VaultError::DistributionNotStarted,
    );
}

#[test]
fn a_holder_with_no_shares_cannot_claim() {
    let f = setup();
    let _user = f.holder(500);
    let stranger = Address::generate(&f.e);
    first_round_now(&f);

    refused(
        f.vault.try_claim_wind_down(&stranger),
        VaultError::NoEntitlement,
    );
}

#[test]
fn a_cancelled_redemption_joins_the_wind_down_payout() {
    let f = setup();
    let user = f.holder(200);
    let epoch = f.vault.request_redeem(&user, &200);
    first_round_now(&f);

    refused(
        f.vault.try_claim_wind_down(&user),
        VaultError::NoEntitlement,
    );
    f.vault.cancel_redeem(&user, &epoch);

    assert_eq!(f.shares(&user), 0);
    assert!(f.vault.claim_wind_down(&user) > 0);
}

#[test]
fn a_token_pause_does_not_hold_a_redemption_in_a_wind_down() {
    let f = setup();
    let user = f.holder(200);
    let epoch = f.vault.request_redeem(&user, &200);
    first_round_now(&f);
    f.share.pause(&f.admin);

    f.vault.cancel_redeem(&user, &epoch);

    assert!(f.vault.claim_wind_down(&user) > 0);
}

/// A freeze holds everything, even an escrow a wind-down would otherwise surrender.
#[test]
fn a_frozen_holders_redemption_stays_escrowed_in_a_wind_down() {
    let f = setup();
    let user = f.holder(200);
    let epoch = f.vault.request_redeem(&user, &200);
    first_round_now(&f);
    f.share.set_address_frozen(&user, &true, &f.compliance);

    refused(f.vault.try_cancel_redeem(&user, &epoch), VaultError::Frozen);
    assert_eq!(f.shares(&f.vault.address), 200);
    assert!(f.vault.get_redeem_request(&epoch, &user).is_some());

    f.share.set_address_frozen(&user, &false, &f.compliance);
    f.vault.cancel_redeem(&user, &epoch);
    assert_eq!(f.vault.claim_wind_down(&user), 400);
}

#[test]
fn a_frozen_holder_is_paid_once_a_compliance_holder_granted_in_the_wind_down_lifts_the_freeze() {
    let f = setup();
    let frozen = f.holder(500);
    let other = f.holder(500);
    first_round_now(&f);
    let role = soroban_sdk::Symbol::new(&f.e, "compliance");
    f.share.set_address_frozen(&frozen, &true, &f.compliance);
    f.share.revoke_role(&f.compliance, &role, &f.admin);
    let paid = f.vault.claim_wind_down(&other);

    let successor = Address::generate(&f.e);
    let id = f.share.propose_change(&share_token::TokenChange::GrantRole(
        role,
        successor.clone(),
    ));
    f.advance(MIN_UPGRADE_DELAY);
    f.share.apply_change(&id);
    f.share.set_address_frozen(&frozen, &false, &successor);

    assert_eq!(f.vault.claim_wind_down(&frozen), paid);
    assert_eq!(f.vault.wind_down_owed(), 0);
}

/// The snapshot left this escrow out, so its shares must not come back to be surrendered.
#[test]
fn a_redemption_that_pays_nothing_returns_no_shares_in_a_wind_down() {
    let f = setup();
    let a = f.holder(200);
    let b = f.holder(200);
    let epoch = f.vault.request_redeem(&a, &1);
    f.fulfill_epoch(WAD_SCALE / 2);
    wind_down_now(&f);
    assert_eq!(f.vault.finalize_wind_down_round(), 800);

    assert_eq!(f.vault.claim_redeem(&a, &epoch), 0);
    let paid = f.vault.claim_wind_down(&a) + f.vault.claim_wind_down(&b);

    assert_eq!(paid, 799);
    assert_eq!(f.vault.wind_down_owed(), 1);
    assert_eq!(f.shares(&a), 0);
    assert_eq!(f.shares(&f.vault.address), 0);
}

/// A cash payout never needs the identity check, even a zero one: the burn
/// still runs for a delisted holder.
#[test]
fn a_delisted_holders_worthless_redemption_burns_in_a_wind_down() {
    let f = setup();
    let a = f.holder(200);
    let b = f.holder(200);
    let epoch = f.vault.request_redeem(&a, &1);
    f.fulfill_epoch(WAD_SCALE / 2);
    wind_down_now(&f);
    f.vault.finalize_wind_down_round();
    f.identity.allow(&a, &false);

    assert_eq!(f.vault.claim_redeem(&a, &epoch), 0);
    f.vault.claim_wind_down(&a);
    f.vault.claim_wind_down(&b);

    assert_eq!(f.shares(&a), 0);
    assert_eq!(f.shares(&f.vault.address), 0);
}

#[test]
fn the_payouts_never_exceed_what_the_rounds_credited() {
    let f = setup();
    let a = f.holder(333);
    let b = f.holder(667);
    f.empty_reserve();
    wind_down_now(&f);
    f.vault.fund(&f.custodian, &7);
    assert_eq!(f.vault.finalize_wind_down_round(), 7);

    let paid = f.vault.claim_wind_down(&a) + f.vault.claim_wind_down(&b);

    assert_eq!(paid, 6);
    assert_eq!(f.balance(&a) + f.balance(&b), paid);
    assert_eq!(paid + f.vault.wind_down_owed(), 7);
    assert_eq!(f.balance(&f.vault.address), f.vault.wind_down_owed());
}

#[test]
fn the_pause_does_not_block_a_wind_down_claim() {
    let f = setup();
    let user = f.holder(500);
    first_round_now(&f);
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
    first_round_now(&f);

    // Known limit: the refund is not tracked as a liability, so a round can
    // credit the assets it needed.
    refused(
        f.vault.try_claim_deposit(&investor, &epoch),
        VaultError::ClaimNotCovered,
    );
}

#[test]
fn the_vault_cannot_claim_against_its_own_escrowed_shares() {
    let f = setup();
    let user = f.holder(500);
    let epoch = f.vault.request_redeem(&user, &200);
    first_round_now(&f);
    let owed = f.vault.wind_down_owed();

    assert_eq!(f.vault.wind_down_claimable(&f.vault.address), 0);
    refused(
        f.vault.try_claim_wind_down(&f.vault.address),
        VaultError::NoEntitlement,
    );
    assert_eq!(f.shares(&f.vault.address), 200);
    assert_eq!(f.vault.wind_down_owed(), owed);
    assert_eq!(f.vault.cancel_redeem(&user, &epoch), 200);
}

#[test]
fn a_position_survives_the_ledger_advancing() {
    let f = setup();
    let user = f.holder(500);
    let backer = f.investor(10_000);
    first_round_now(&f);
    f.vault.claim_wind_down(&user);

    f.advance(29 * DAY_DURATION);

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
    // Round 1
    first_round_now(&f);
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
        &f.vault.wind_down_distributed(),
        &f.vault.wind_down_supply(),
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
    first_round_now(&f);
    let first = f.vault.claim_wind_down(&h1);

    f.vault.fund(&backer, &333);
    f.vault.finalize_wind_down_round();
    let second = f.vault.claim_wind_down(&h2);

    f.vault.fund(&backer, &333);
    f.vault.finalize_wind_down_round();
    let last = f.vault.claim_wind_down(&h3);

    let late = [f.vault.claim_wind_down(&h1), f.vault.claim_wind_down(&h2)];
    let paid = first + second + last + late[0] + late[1];

    assert_eq!([first, second, last], [666, 776, 890]);
    assert_eq!(late, [221, 111]);
    assert_eq!(f.vault.wind_down_distributed(), 2_666);
    assert_eq!(paid + f.vault.wind_down_owed(), 2_666);
    assert_eq!(f.vault.wind_down_owed(), 2);
    assert_eq!(f.balance(&f.vault.address), f.vault.wind_down_owed());
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
fn shares_sent_to_the_vault_are_refused_so_the_snapshot_counts_holders_only() {
    let f = setup();
    let a = f.holder(500);
    let _b = f.holder(300);

    assert_eq!(
        f.share.try_transfer(&a, &f.vault.address, &100),
        Err(Ok(share_token::ShareTokenError::VaultAddress.into())),
    );
    first_round_now(&f);
    assert_eq!(f.vault.wind_down_supply(), 800);
}

#[test]
fn propose_wind_down_reports_active_when_active() {
    let f = setup();
    let _user = f.holder(500);
    wind_down_now(&f);

    let err = f.vault.try_propose_wind_down().unwrap_err().unwrap();
    assert_eq!(err, VaultError::WindDownActive.into());
}

/// Each holder's payout floors, so `owed` can keep a unit per holder after
/// everyone has claimed. That unit is not free to release: a later round lets
/// each floor catch up and needs it.
#[test]
fn a_later_round_needs_the_units_an_earlier_round_left_in_owed() {
    let f = setup();
    let a = f.holder(1);
    let b = f.holder(1);
    f.empty_reserve();
    wind_down_now(&f);

    f.vault.fund(&f.custodian, &1);
    assert_eq!(f.vault.finalize_wind_down_round(), 1);
    assert_eq!(f.vault.claim_wind_down(&a), 0);
    assert_eq!(f.vault.claim_wind_down(&b), 0);
    assert_eq!(f.vault.wind_down_owed(), 1);

    f.vault.fund(&f.custodian, &1);
    assert_eq!(f.vault.finalize_wind_down_round(), 1);
    assert_eq!(f.vault.claim_wind_down(&a), 1);
    assert_eq!(f.vault.claim_wind_down(&b), 1);

    assert_eq!(f.vault.wind_down_owed(), 0);
    assert_eq!(f.balance(&f.vault.address), 0);
}

#[test]
fn a_round_of_one_unit_at_the_lowest_price_still_credits_it() {
    let f = setup();
    let whale = f.investor(10i128.pow(13));
    let epoch = f.vault.request_deposit(&whale, &10i128.pow(13));
    f.fulfill_epoch(MIN_ANSWER);
    f.vault.claim_deposit(&whale, &epoch);
    assert_eq!(f.shares(&whale), 10i128.pow(19));
    f.empty_reserve();
    wind_down_now(&f);
    f.vault.fund(&f.custodian, &1);

    assert_eq!(f.vault.finalize_wind_down_round(), 1);
    assert_eq!(f.vault.claim_wind_down(&whale), 1);
    assert_eq!(f.vault.wind_down_owed(), 0);
}

#[test]
fn at_the_lowest_price_holders_collect_the_reserve_less_a_unit_each() {
    let f = setup();
    let deposit = 5 * 10i128.pow(12);
    let a = f.investor(deposit);
    let b = f.investor(deposit);
    let epoch = f.vault.request_deposit(&a, &deposit);
    f.vault.request_deposit(&b, &deposit);
    f.fulfill_epoch(MIN_ANSWER);
    f.vault.claim_deposit(&a, &epoch);
    f.vault.claim_deposit(&b, &epoch);
    f.empty_reserve();
    wind_down_now(&f);
    let pot = 1_000_000_007;
    f.vault.fund(&f.custodian, &pot);

    assert_eq!(f.vault.finalize_wind_down_round(), pot);
    let paid = f.vault.claim_wind_down(&a) + f.vault.claim_wind_down(&b);
    let owed = f.vault.wind_down_owed();
    assert!(owed < 2);
    assert_eq!(paid + owed, pot);
}

proptest! {
    #![proptest_config(ProptestConfig::with_cases(24))]

    /// The bound only holds for shares the snapshot counted and that were
    /// actually surrendered: random holders, each fully claiming, over a
    /// random number of funding rounds. `owed` never reaches the holder
    /// count, because each holder's own floor loses less than one unit.
    #[test]
    fn owed_stays_below_the_holder_count_once_every_share_is_surrendered(
        holdings in proptest::collection::vec(1i128..1_000, 1..6),
        extra_fundings in proptest::collection::vec(1i128..1_000, 0..3),
    ) {
        let f = setup();
        let holders: std::vec::Vec<Address> =
            holdings.iter().map(|shares| f.holder(*shares)).collect();
        let total_shares: i128 = holdings.iter().sum();
        let backer = f.investor(total_shares + 10_000);
        f.empty_reserve();
        wind_down_now(&f);

        // Funds exactly the snapshot, so the first round always credits
        // something whatever the random holdings: every holder below then
        // always has a round to claim against.
        f.vault.fund(&backer, &total_shares);
        f.vault.finalize_wind_down_round();

        for amount in &extra_fundings {
            f.vault.fund(&backer, amount);
            let _ = f.vault.try_finalize_wind_down_round();
        }

        for holder in &holders {
            f.vault.claim_wind_down(holder);
        }

        prop_assert!(f.vault.wind_down_owed() < holders.len() as i128);
        prop_assert!(f.balance(&f.vault.address) >= f.vault.wind_down_owed());
    }
}

#[test]
fn a_frozen_holders_slice_stays_owed_until_the_freeze_lifts() {
    let f = setup();
    let frozen = f.holder(500);
    let other = f.holder(500);
    first_round_now(&f);
    f.share.set_address_frozen(&frozen, &true, &f.compliance);

    refused(f.vault.try_claim_wind_down(&frozen), VaultError::Frozen);
    let paid = f.vault.claim_wind_down(&other);
    assert_eq!(f.vault.wind_down_owed(), paid);
    assert_eq!(f.shares(&frozen), 500);

    f.share.set_address_frozen(&frozen, &false, &f.compliance);
    assert_eq!(f.vault.claim_wind_down(&frozen), paid);
    assert_eq!(f.vault.wind_down_owed(), 0);
}

#[test]
fn a_frozen_holders_escrowed_exit_waits_through_a_wind_down() {
    let f = setup();
    let frozen = f.holder(500);
    let _other = f.holder(500);
    let epoch = f.vault.request_redeem(&frozen, &500);
    f.share.set_address_frozen(&frozen, &true, &f.compliance);
    first_round_now(&f);

    refused(
        f.vault.try_cancel_redeem(&frozen, &epoch),
        VaultError::Frozen,
    );
    refused(f.vault.try_claim_wind_down(&frozen), VaultError::Frozen);

    f.share.set_address_frozen(&frozen, &false, &f.compliance);
    assert_eq!(f.vault.cancel_redeem(&frozen, &epoch), 500);
    assert!(f.vault.claim_wind_down(&frozen) > 0);
}

#[test]
fn wind_down_claimable_is_zero_for_a_frozen_holder() {
    let f = setup();
    let holder = f.holder(500);
    first_round_now(&f);
    f.share.set_address_frozen(&holder, &true, &f.compliance);

    assert_eq!(f.vault.wind_down_claimable(&holder), 0);
}

#[test]
fn the_claimable_view_and_the_claim_fail_alike_at_the_overflow_edge() {
    let f = setup();
    let holder = f.holder(500);
    f.empty_reserve();
    wind_down_now(&f);
    f.vault.fund(&f.custodian, &100);
    f.vault.finalize_wind_down_round();
    f.e.as_contract(&f.vault.address, || {
        strata_storage::set_persistent(
            &f.e,
            &crate::keys::DataKey::WindDownPosition(holder.clone()),
            &crate::WindDownPosition {
                entitlement: i128::MAX - 100,
                paid: 0,
            },
        )
    });

    refused(
        f.vault.try_wind_down_claimable(&holder),
        VaultError::AmountTooLarge,
    );
    refused(
        f.vault.try_claim_wind_down(&holder),
        VaultError::AmountTooLarge,
    );
}

#[test]
fn the_claimable_view_shows_what_the_claim_then_pays() {
    let f = setup();
    let a = f.holder(300);
    let _b = f.holder(700);
    first_round_now(&f);

    let shown = f.vault.wind_down_claimable(&a);
    assert!(shown > 0);
    assert_eq!(f.vault.claim_wind_down(&a), shown);
    assert_eq!(f.vault.wind_down_claimable(&a), 0);
}

#[test]
fn a_partial_freeze_keeps_frozen_shares_out_of_a_wind_down_claim() {
    let f = setup();
    let holder = f.holder(500);
    let _other = f.holder(500);
    first_round_now(&f);
    f.share.freeze_partial_tokens(&holder, &400, &f.compliance);

    let first = f.vault.claim_wind_down(&holder);

    assert_eq!(f.shares(&holder), 400);
    assert_eq!(f.share.get_frozen_tokens(&holder), 400);
    f.share
        .unfreeze_partial_tokens(&holder, &400, &f.compliance);
    let rest = f.vault.claim_wind_down(&holder);
    assert_eq!(rest, 4 * first);
}

#[test]
fn a_snapshot_with_more_shares_to_burn_than_exist_fails_loudly() {
    let f = setup();
    wind_down_now(&f);
    f.e.as_contract(&f.vault.address, || {
        crate::state::set_pending_burn_shares(&f.e, 1)
    });

    refused(
        f.vault.try_finalize_wind_down_round(),
        VaultError::AccountingMismatch,
    );
}

#[test]
fn a_payout_below_what_was_already_paid_fails_loudly() {
    let f = setup();
    let _holder = f.holder(500);
    first_round_now(&f);
    let newcomer = f.investor(0);
    f.e.as_contract(&f.vault.address, || {
        strata_storage::set_persistent(
            &f.e,
            &crate::keys::DataKey::WindDownPosition(newcomer.clone()),
            &crate::WindDownPosition {
                entitlement: 0,
                paid: 1,
            },
        )
    });

    refused(
        f.vault.try_wind_down_claimable(&newcomer),
        VaultError::AccountingMismatch,
    );
    refused(
        f.vault.try_claim_wind_down(&newcomer),
        VaultError::AccountingMismatch,
    );
}
