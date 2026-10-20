//! Each guard passes while its condition holds and refuses with its error once
//! it does not.

use soroban_sdk::InvokeError;
use stellar_tokens::rwa::compliance::ComplianceHook;

use super::share_returns::RefusesEveryTransfer;
use super::wind_down::wind_down_now;
use super::*;
use crate::guards;
use crate::lock_policy::{Decision, Exit, Standing};
use crate::{EpochInfo, WindDownInfo};

/// Runs `guard` inside the vault, as an entrypoint would.
fn run(f: &Fixture, guard: impl FnOnce()) -> Result<(), Result<soroban_sdk::Error, InvokeError>> {
    f.e.try_as_contract::<(), soroban_sdk::Error>(&f.vault.address, guard)
}

fn holds(f: &Fixture, guard: impl FnOnce()) {
    assert_eq!(run(f, guard), Ok(()));
}

fn refuses(f: &Fixture, error: VaultError, guard: impl FnOnce()) {
    assert_eq!(run(f, guard), Err(Ok(error.into())));
}

fn epoch(f: &Fixture, id: u64) -> EpochInfo {
    f.vault.get_epoch(&id).unwrap()
}

#[test]
fn roles_distinct_refuses_one_account_in_two_seats_kept_apart() {
    let f = setup();
    let roles = distinct_roles(&f.e);
    holds(&f, || guards::roles_distinct(&f.e, &roles));

    for shared in [
        VaultRoles {
            guardian: roles.treasury.clone(),
            ..roles.clone()
        },
        VaultRoles {
            governance: roles.treasury.clone(),
            ..roles.clone()
        },
        VaultRoles {
            governance: roles.compliance.clone(),
            ..roles.clone()
        },
        VaultRoles {
            treasury: roles.compliance.clone(),
            ..roles.clone()
        },
    ] {
        refuses(&f, VaultError::RolesNotDistinct, || {
            guards::roles_distinct(&f.e, &shared)
        });
    }
}

#[test]
fn not_winding_down_refuses_once_the_wind_down_is_active() {
    let f = setup();
    holds(&f, || guards::not_winding_down(&f.e));

    f.vault.propose_wind_down();
    holds(&f, || guards::not_winding_down(&f.e));

    f.advance(MIN_WIND_DOWN_DELAY);
    f.vault.activate_wind_down();
    refuses(&f, VaultError::WindDownActive, || {
        guards::not_winding_down(&f.e)
    });
}

#[test]
fn winding_down_refuses_until_the_wind_down_is_active() {
    let f = setup();
    refuses(&f, VaultError::WindDownNotActive, || {
        guards::winding_down(&f.e)
    });

    f.vault.propose_wind_down();
    refuses(&f, VaultError::WindDownNotActive, || {
        guards::winding_down(&f.e)
    });

    f.advance(MIN_WIND_DOWN_DELAY);
    f.vault.activate_wind_down();
    holds(&f, || guards::winding_down(&f.e));
}

#[test]
fn setup_finished_refuses_while_setup_is_open() {
    let open = setup_unfinished();
    refuses(&open, VaultError::SetupOpen, || {
        guards::setup_finished(&open.e)
    });

    let finished = setup();
    holds(&finished, || guards::setup_finished(&finished.e));
}

#[test]
fn setup_open_refuses_once_setup_has_finished() {
    let open = setup_unfinished();
    holds(&open, || guards::setup_open(&open.e));

    let finished = setup();
    refuses(&finished, VaultError::SetupClosed, || {
        guards::setup_open(&finished.e)
    });
}

#[test]
fn direct_change_allowed_refuses_after_setup() {
    let open = setup_unfinished();
    holds(&open, || guards::direct_change_allowed(&open.e));

    let finished = setup();
    refuses(&finished, VaultError::UseTimelock, || {
        guards::direct_change_allowed(&finished.e)
    });
}

#[test]
fn direct_revoke_allowed_refuses_only_the_manager_role_after_setup() {
    let open = setup_unfinished();
    holds(&open, || {
        guards::direct_revoke_allowed(&open.e, &symbol_short!("manager"))
    });

    let f = setup();
    holds(&f, || {
        guards::direct_revoke_allowed(&f.e, &symbol_short!("guardian"))
    });
    holds(&f, || {
        guards::direct_revoke_allowed(&f.e, &symbol_short!("treasury"))
    });
    refuses(&f, VaultError::UseTimelock, || {
        guards::direct_revoke_allowed(&f.e, &symbol_short!("manager"))
    });
}

#[test]
fn direct_hand_over_allowed_refuses_only_an_offer_after_setup() {
    let open = setup_unfinished();
    holds(&open, || guards::direct_hand_over_allowed(&open.e, 100));

    let f = setup();
    holds(&f, || guards::direct_hand_over_allowed(&f.e, 0));
    refuses(&f, VaultError::UseTimelock, || {
        guards::direct_hand_over_allowed(&f.e, 100)
    });
}

#[test]
fn not_lowered_after_setup_refuses_only_a_lower_value_after_setup() {
    let open = setup_unfinished();
    holds(&open, || guards::not_lowered_after_setup(&open.e, 1, 2));

    let f = setup();
    holds(&f, || guards::not_lowered_after_setup(&f.e, 2, 2));
    holds(&f, || guards::not_lowered_after_setup(&f.e, 3, 2));
    refuses(&f, VaultError::UseTimelock, || {
        guards::not_lowered_after_setup(&f.e, 1, 2)
    });
}

#[test]
fn no_hand_over_pending_refuses_while_an_offer_is_open() {
    let f = setup_unfinished();
    holds(&f, || guards::no_hand_over_pending(&f.e));

    let next = Address::generate(&f.e);
    f.vault
        .transfer_admin_role(&next, &(f.e.ledger().sequence() + 100));
    refuses(&f, VaultError::AdminTransferPending, || {
        guards::no_hand_over_pending(&f.e)
    });

    f.vault.transfer_admin_role(&next, &0);
    holds(&f, || guards::no_hand_over_pending(&f.e));
}

#[test]
fn caller_is_admin_refuses_anyone_but_the_admin() {
    let f = setup();
    let stranger = Address::generate(&f.e);
    holds(&f, || guards::caller_is_admin(&f.e, &f.admin));

    for who in [&f.guardian, &f.manager, &stranger] {
        refuses(&f, VaultError::AdminRequired, || {
            guards::caller_is_admin(&f.e, who)
        });
    }
}

#[test]
fn wiring_complete_refuses_a_miswired_vault() {
    let wired = setup_unfinished();
    holds(&wired, || guards::wiring_complete(&wired.e));

    let unbound = miswired(Miswire::TokenUnbound);
    refuses(&unbound, VaultError::SetupIncomplete, || {
        guards::wiring_complete(&unbound.e)
    });
}

#[test]
fn non_negative_cap_refuses_a_negative_cap() {
    let f = setup();
    holds(&f, || guards::non_negative_cap(&f.e, None));
    holds(&f, || guards::non_negative_cap(&f.e, Some(0)));
    refuses(&f, VaultError::InvalidAmount, || {
        guards::non_negative_cap(&f.e, Some(-1))
    });
}

#[test]
fn notice_in_bounds_refuses_a_notice_too_long_or_above_the_upgrade_delay() {
    let f = setup();
    holds(&f, || guards::notice_in_bounds(&f.e, 0));
    holds(&f, || guards::notice_in_bounds(&f.e, MIN_UPGRADE_DELAY));
    refuses(&f, VaultError::NoticeAboveUpgradeDelay, || {
        guards::notice_in_bounds(&f.e, MIN_UPGRADE_DELAY + 1)
    });
    refuses(&f, VaultError::NoticeTooLong, || {
        guards::notice_in_bounds(&f.e, MAX_NOTICE_SECS + 1)
    });
}

#[test]
fn wind_down_delay_in_bounds_refuses_a_delay_outside_the_bounds() {
    let f = setup();
    holds(&f, || {
        guards::wind_down_delay_in_bounds(&f.e, MIN_WIND_DOWN_DELAY)
    });
    holds(&f, || {
        guards::wind_down_delay_in_bounds(&f.e, MAX_WIND_DOWN_DELAY)
    });
    refuses(&f, VaultError::WindDownDelayTooShort, || {
        guards::wind_down_delay_in_bounds(&f.e, MIN_WIND_DOWN_DELAY - 1)
    });
    refuses(&f, VaultError::WindDownDelayTooLong, || {
        guards::wind_down_delay_in_bounds(&f.e, MAX_WIND_DOWN_DELAY + 1)
    });
}

#[test]
fn upgrade_delay_in_bounds_refuses_a_delay_outside_the_bounds_or_below_the_notice() {
    let f = setup();
    holds(&f, || {
        guards::upgrade_delay_in_bounds(&f.e, MIN_UPGRADE_DELAY)
    });
    holds(&f, || {
        guards::upgrade_delay_in_bounds(&f.e, MAX_UPGRADE_DELAY)
    });
    refuses(&f, VaultError::UpgradeDelayTooShort, || {
        guards::upgrade_delay_in_bounds(&f.e, MIN_UPGRADE_DELAY - 1)
    });
    refuses(&f, VaultError::UpgradeDelayTooLong, || {
        guards::upgrade_delay_in_bounds(&f.e, MAX_UPGRADE_DELAY + 1)
    });

    f.e.as_contract(&f.vault.address, || {
        crate::state::set_notice(&f.e, 10 * DAY_DURATION)
    });
    refuses(&f, VaultError::UpgradeDelayBelowNotice, || {
        guards::upgrade_delay_in_bounds(&f.e, 8 * DAY_DURATION)
    });
}

#[test]
fn custodian_not_the_vault_refuses_the_vault_itself() {
    let f = setup();
    holds(&f, || guards::custodian_not_the_vault(&f.e, &f.custodian));
    refuses(&f, VaultError::InvalidCustodian, || {
        guards::custodian_not_the_vault(&f.e, &f.vault.address)
    });
}

#[test]
fn feed_bound_here_refuses_a_feed_not_bound_to_this_vault() {
    let f = setup();
    holds(&f, || guards::feed_bound_here(&f.e, &f.oracle.address));

    let unbound = f.e.register(
        NavOracleContract,
        (
            f.admin.clone(),
            f.attester.clone(),
            f.guardian.clone(),
            open_feed(),
        ),
    );
    refuses(&f, VaultError::FeedNotBound, || {
        guards::feed_bound_here(&f.e, &unbound)
    });
}

#[test]
fn change_in_bounds_checks_the_bounds_of_each_change() {
    let f = setup();
    let stranger = Address::generate(&f.e);
    for change in [
        VaultChange::Upgrade(BytesN::from_array(&f.e, &[1; 32])),
        VaultChange::UpgradeDelay(MIN_UPGRADE_DELAY),
        VaultChange::Custodian(stranger.clone()),
        VaultChange::Notice(0),
        VaultChange::WindDownDelay(MIN_WIND_DOWN_DELAY),
        VaultChange::GrantRole(symbol_short!("guardian"), stranger.clone()),
        VaultChange::RevokeRole(symbol_short!("guardian"), stranger.clone()),
        VaultChange::Admin(stranger.clone()),
        VaultChange::Oracle(f.oracle.address.clone()),
    ] {
        holds(&f, || guards::change_in_bounds(&f.e, &change));
    }

    for (change, error) in [
        (
            VaultChange::UpgradeDelay(MIN_UPGRADE_DELAY - 1),
            VaultError::UpgradeDelayTooShort,
        ),
        (
            VaultChange::Notice(MAX_NOTICE_SECS + 1),
            VaultError::NoticeTooLong,
        ),
        (
            VaultChange::WindDownDelay(MAX_WIND_DOWN_DELAY + 1),
            VaultError::WindDownDelayTooLong,
        ),
        (
            VaultChange::Oracle(stranger.clone()),
            VaultError::FeedNotBound,
        ),
        (
            VaultChange::Custodian(f.vault.address.clone()),
            VaultError::InvalidCustodian,
        ),
    ] {
        refuses(&f, error, || guards::change_in_bounds(&f.e, &change));
    }
}

#[test]
fn not_a_second_code_change_refuses_a_code_change_while_one_waits() {
    let f = setup();
    let upgrade = VaultChange::Upgrade(BytesN::from_array(&f.e, &[1; 32]));
    holds(&f, || guards::not_a_second_code_change(&f.e, &upgrade));

    f.vault
        .propose_change(&VaultChange::UpgradeDelay(MIN_UPGRADE_DELAY));
    refuses(&f, VaultError::UpgradeProposalExists, || {
        guards::not_a_second_code_change(&f.e, &upgrade)
    });
    refuses(&f, VaultError::UpgradeProposalExists, || {
        guards::not_a_second_code_change(&f.e, &VaultChange::UpgradeDelay(MAX_UPGRADE_DELAY))
    });
    holds(&f, || {
        guards::not_a_second_code_change(&f.e, &VaultChange::Notice(0))
    });
}

#[test]
fn no_wind_down_proposed_refuses_a_standing_proposal() {
    let f = setup();
    holds(&f, || guards::no_wind_down_proposed(&f.e));

    f.vault.propose_wind_down();
    refuses(&f, VaultError::WindDownAlreadyProposed, || {
        guards::no_wind_down_proposed(&f.e)
    });
}

#[test]
fn wind_down_proposed_refuses_without_a_standing_proposal() {
    let f = setup();
    refuses(&f, VaultError::WindDownNotProposed, || {
        guards::wind_down_proposed(&f.e)
    });

    f.vault.propose_wind_down();
    holds(&f, || guards::wind_down_proposed(&f.e));

    f.advance(MIN_WIND_DOWN_DELAY);
    f.vault.activate_wind_down();
    refuses(&f, VaultError::WindDownNotProposed, || {
        guards::wind_down_proposed(&f.e)
    });
}

#[test]
fn wind_down_delay_elapsed_refuses_before_the_activation_time() {
    let f = setup();
    let now = f.e.ledger().timestamp();
    let proposal = |active_at| WindDownInfo {
        status: WindDownStatus::Proposed,
        active_at,
        round: 0,
    };

    holds(&f, || guards::wind_down_delay_elapsed(&f.e, &proposal(now)));
    refuses(&f, VaultError::WindDownDelayNotElapsed, || {
        guards::wind_down_delay_elapsed(&f.e, &proposal(now + 1))
    });
}

#[test]
fn distribution_started_refuses_before_the_first_round() {
    let f = setup();
    let _holder = f.holder(500);
    refuses(&f, VaultError::DistributionNotStarted, || {
        guards::distribution_started(&f.e)
    });

    wind_down_now(&f);
    refuses(&f, VaultError::DistributionNotStarted, || {
        guards::distribution_started(&f.e)
    });

    f.vault.finalize_wind_down_round();
    holds(&f, || guards::distribution_started(&f.e));
}

#[test]
fn something_to_distribute_refuses_zero_and_below() {
    let f = setup();
    holds(&f, || guards::something_to_distribute(&f.e, 1));
    refuses(&f, VaultError::NothingToDistribute, || {
        guards::something_to_distribute(&f.e, 0)
    });
    refuses(&f, VaultError::NothingToDistribute, || {
        guards::something_to_distribute(&f.e, -1)
    });
}

#[test]
fn has_entitlement_refuses_when_nothing_is_surrendered_or_owed() {
    let f = setup();
    holds(&f, || guards::has_entitlement(&f.e, 1, 0));
    holds(&f, || guards::has_entitlement(&f.e, 0, 1));
    refuses(&f, VaultError::NoEntitlement, || {
        guards::has_entitlement(&f.e, 0, 0)
    });
}

#[test]
fn positive_amount_refuses_zero_and_below() {
    let f = setup();
    holds(&f, || guards::positive_amount(&f.e, 1));
    refuses(&f, VaultError::InvalidAmount, || {
        guards::positive_amount(&f.e, 0)
    });
    refuses(&f, VaultError::InvalidAmount, || {
        guards::positive_amount(&f.e, -1)
    });
}

#[test]
fn within_cap_refuses_a_deposit_past_the_cap() {
    let f = setup();
    holds(&f, || guards::within_cap(&f.e, i128::MAX));

    f.vault.set_deposit_cap(&Some(1_000));
    let investor = f.investor(400);
    f.vault.request_deposit(&investor, &400);
    holds(&f, || guards::within_cap(&f.e, 600));
    refuses(&f, VaultError::DepositCapExceeded, || {
        guards::within_cap(&f.e, 601)
    });
    refuses(&f, VaultError::AmountTooLarge, || {
        guards::within_cap(&f.e, i128::MAX)
    });
}

#[test]
fn within_free_reserve_refuses_more_than_the_free_reserve() {
    let f = setup();
    let _holder = f.holder(500);

    holds(&f, || guards::within_free_reserve(&f.e, 1_000));
    refuses(&f, VaultError::ReserveCommittedToExits, || {
        guards::within_free_reserve(&f.e, 1_001)
    });
}

#[test]
fn no_open_deposit_refuses_a_second_request_in_the_epoch() {
    let f = setup();
    let investor = f.investor(1_000);
    let current = f.vault.current_epoch();
    holds(&f, || guards::no_open_deposit(&f.e, current, &investor));

    f.vault.request_deposit(&investor, &400);
    refuses(&f, VaultError::RequestOutstanding, || {
        guards::no_open_deposit(&f.e, current, &investor)
    });
    holds(&f, || guards::no_open_deposit(&f.e, current + 1, &investor));
}

#[test]
fn no_open_redeem_refuses_a_second_request_in_the_epoch() {
    let f = setup();
    let holder = f.holder(500);
    let current = f.vault.current_epoch();
    holds(&f, || guards::no_open_redeem(&f.e, current, &holder));

    f.vault.request_redeem(&holder, &100);
    refuses(&f, VaultError::RequestOutstanding, || {
        guards::no_open_redeem(&f.e, current, &holder)
    });
    holds(&f, || guards::no_open_redeem(&f.e, current + 1, &holder));
}

#[test]
fn not_claimed_refuses_a_claimed_request() {
    let f = setup();
    holds(&f, || guards::not_claimed(&f.e, false));
    refuses(&f, VaultError::AlreadyClaimed, || {
        guards::not_claimed(&f.e, true)
    });
}

/// Beyond the whole balance the guard stands aside: the token's own check
/// refuses that request.
#[test]
fn needs_no_frozen_shares_refuses_a_request_that_reaches_frozen_shares() {
    let f = setup();
    let holder = f.holder(500);
    f.share.freeze_partial_tokens(&holder, &400, &f.compliance);

    holds(&f, || guards::needs_no_frozen_shares(&f.e, &holder, 100));
    refuses(&f, VaultError::Frozen, || {
        guards::needs_no_frozen_shares(&f.e, &holder, 101)
    });
    refuses(&f, VaultError::Frozen, || {
        guards::needs_no_frozen_shares(&f.e, &holder, 500)
    });
    holds(&f, || guards::needs_no_frozen_shares(&f.e, &holder, 501));
}

#[test]
fn refund_covered_refuses_a_refund_beyond_the_free_reserve() {
    let f = setup();
    let _holder = f.holder(500);

    holds(&f, || guards::refund_covered(&f.e, 1_000));
    refuses(&f, VaultError::ClaimNotCovered, || {
        guards::refund_covered(&f.e, 1_001)
    });
}

#[test]
fn payout_covered_refuses_a_payout_beyond_the_liquid_reserve() {
    let f = setup();
    let _holder = f.holder(500);
    let investor = f.investor(300);
    f.vault.request_deposit(&investor, &300);

    holds(&f, || guards::payout_covered(&f.e, 1_000));
    refuses(&f, VaultError::ClaimNotCovered, || {
        guards::payout_covered(&f.e, 1_001)
    });
}

#[test]
fn eligible_to_receive_refuses_a_holder_the_token_would_not_take() {
    let f = setup();
    let listed = f.investor(0);
    holds(&f, || guards::eligible_to_receive(&f.e, &listed, 1));

    let delisted = f.unverified_investor(0);
    refuses(&f, VaultError::HolderNotEligible, || {
        guards::eligible_to_receive(&f.e, &delisted, 1)
    });

    let frozen = f.investor(0);
    f.share.set_address_frozen(&frozen, &true, &f.compliance);
    refuses(&f, VaultError::HolderNotEligible, || {
        guards::eligible_to_receive(&f.e, &frozen, 1)
    });

    let module = f.e.register(RefusesEveryTransfer, ());
    f.add_compliance_module(ComplianceHook::CanTransfer, &module);
    refuses(&f, VaultError::HolderNotEligible, || {
        guards::eligible_to_receive(&f.e, &listed, 1)
    });
}

#[test]
fn epoch_open_refuses_a_sealed_epoch() {
    let f = setup();
    let open = epoch(&f, f.vault.current_epoch());
    holds(&f, || guards::epoch_open(&f.e, &open));

    let sealed = epoch(&f, f.close_epoch());
    refuses(&f, VaultError::EpochNotOpen, || {
        guards::epoch_open(&f.e, &sealed)
    });
}

#[test]
fn epoch_fulfilled_refuses_an_epoch_not_yet_priced() {
    let f = setup();
    let id = f.close_epoch();
    let sealed = epoch(&f, id);
    refuses(&f, VaultError::EpochNotFulfilled, || {
        guards::epoch_fulfilled(&f.e, &sealed)
    });

    f.fulfill_epoch_at(id, wad(1));
    let priced = epoch(&f, id);
    holds(&f, || guards::epoch_fulfilled(&f.e, &priced));
}

#[test]
fn not_priced_refuses_a_priced_epoch() {
    let f = setup();
    let id = f.close_epoch();
    let sealed = epoch(&f, id);
    holds(&f, || guards::not_priced(&f.e, &sealed));

    f.fulfill_epoch_at(id, wad(1));
    let priced = epoch(&f, id);
    refuses(&f, VaultError::AlreadyPriced, || {
        guards::not_priced(&f.e, &priced)
    });
}

#[test]
fn no_price_available_refuses_a_sealed_epoch_the_vault_could_price() {
    let f = setup();
    let open = epoch(&f, f.vault.current_epoch());
    holds(&f, || guards::no_price_available(&f.e, &open));

    let id = f.close_epoch();
    let sealed = epoch(&f, id);
    holds(&f, || guards::no_price_available(&f.e, &sealed));

    f.attest(wad(1));
    refuses(&f, VaultError::PriceAvailable, || {
        guards::no_price_available(&f.e, &sealed)
    });

    f.vault.pause(&f.guardian);
    holds(&f, || guards::no_price_available(&f.e, &sealed));
    f.vault.unpause(&f.admin);

    wind_down_now(&f);
    f.attest(wad(1));
    holds(&f, || guards::no_price_available(&f.e, &sealed));
}

#[test]
fn fulfilable_refuses_an_epoch_the_vault_cannot_price_yet() {
    let f = setup();
    let open = epoch(&f, f.vault.current_epoch());
    refuses(&f, VaultError::EpochNotPending, || {
        guards::fulfilable(&f.e, &open)
    });

    let unpriced = epoch(&f, f.close_epoch());
    refuses(&f, VaultError::FeedNotValid, || {
        guards::fulfilable(&f.e, &unpriced)
    });
    f.attest(wad(1));
    holds(&f, || guards::fulfilable(&f.e, &unpriced));

    f.advance(10);
    let behind_the_report = epoch(&f, f.close_epoch());
    refuses(&f, VaultError::AttestationBeforeClose, || {
        guards::fulfilable(&f.e, &behind_the_report)
    });

    f.vault.set_notice(&3_600);
    let within_the_notice = epoch(&f, f.close_epoch());
    refuses(&f, VaultError::NoticeNotElapsed, || {
        guards::fulfilable(&f.e, &within_the_notice)
    });
}

#[test]
fn allowed_to_refuses_anything_but_going_ahead() {
    let f = setup();
    let listed = f.investor(0);
    let delisted = f.unverified_investor(0);
    let frozen = f.investor(0);
    f.share.set_address_frozen(&frozen, &true, &f.compliance);

    holds(&f, || {
        guards::allowed_to(&f.e, Exit::RequestDeposit, &listed)
    });
    refuses(&f, VaultError::NotAllowlisted, || {
        guards::allowed_to(&f.e, Exit::RequestDeposit, &delisted)
    });
    refuses(&f, VaultError::Frozen, || {
        guards::allowed_to(&f.e, Exit::RequestDeposit, &frozen)
    });

    holds(&f, || {
        guards::allowed_to(&f.e, Exit::RequestRedeem, &delisted)
    });
    refuses(&f, VaultError::Frozen, || {
        guards::allowed_to(&f.e, Exit::RequestRedeem, &frozen)
    });

    refuses(&f, VaultError::NotAllowlisted, || {
        guards::allowed_to(&f.e, Exit::ClaimDeposit, &delisted)
    });
}

#[test]
fn not_refused_refuses_a_refusal_or_a_hold() {
    let f = setup();
    for decision in [
        Decision::Proceed,
        Decision::ConvertToExit,
        Decision::Surrender,
    ] {
        holds(&f, || {
            guards::not_refused(&f.e, decision, Standing::Delisted)
        });
    }

    refuses(&f, VaultError::NotAllowlisted, || {
        guards::not_refused(&f.e, Decision::Refuse, Standing::Delisted)
    });
    refuses(&f, VaultError::Frozen, || {
        guards::not_refused(&f.e, Decision::Hold, Standing::Frozen)
    });
}
