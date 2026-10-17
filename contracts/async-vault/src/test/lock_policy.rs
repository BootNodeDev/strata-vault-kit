use super::*;
use crate::lock_policy::{self, Decision, Exit, Standing};

fn in_and_out_of_a_wind_down(exit: Exit, standing: Standing) -> [Decision; 2] {
    [
        lock_policy::decide(exit, standing, false),
        lock_policy::decide(exit, standing, true),
    ]
}

#[test]
fn a_listed_holder_may_request_a_deposit() {
    assert_eq!(
        in_and_out_of_a_wind_down(Exit::RequestDeposit, Standing::Listed),
        [Decision::Proceed; 2]
    );
}

#[test]
fn a_delisted_holder_may_not_request_a_deposit() {
    assert_eq!(
        in_and_out_of_a_wind_down(Exit::RequestDeposit, Standing::Delisted),
        [Decision::Refuse; 2]
    );
}

#[test]
fn a_frozen_holder_may_not_request_a_deposit() {
    assert_eq!(
        in_and_out_of_a_wind_down(Exit::RequestDeposit, Standing::Frozen),
        [Decision::Refuse; 2]
    );
}

#[test]
fn a_listed_holder_claims_the_shares() {
    assert_eq!(
        lock_policy::decide(Exit::ClaimDeposit, Standing::Listed, false),
        Decision::Proceed
    );
}

#[test]
fn a_delisted_holders_claim_joins_the_exit_queue() {
    assert_eq!(
        lock_policy::decide(Exit::ClaimDeposit, Standing::Delisted, false),
        Decision::ConvertToExit
    );
}

#[test]
fn a_frozen_holders_claim_is_held() {
    assert_eq!(
        lock_policy::decide(Exit::ClaimDeposit, Standing::Frozen, false),
        Decision::Hold
    );
}

#[test]
fn in_a_wind_down_a_listed_holder_claims_the_shares() {
    assert_eq!(
        lock_policy::decide(Exit::ClaimDeposit, Standing::Listed, true),
        Decision::Proceed
    );
}

#[test]
fn in_a_wind_down_a_delisted_holders_claim_joins_the_entitlement() {
    assert_eq!(
        lock_policy::decide(Exit::ClaimDeposit, Standing::Delisted, true),
        Decision::Surrender
    );
}

#[test]
fn in_a_wind_down_a_frozen_holders_claim_is_held() {
    assert_eq!(
        lock_policy::decide(Exit::ClaimDeposit, Standing::Frozen, true),
        Decision::Hold
    );
}

#[test]
fn a_listed_holder_may_cancel_a_redemption_back_to_shares() {
    assert_eq!(
        lock_policy::decide(Exit::CancelRedeem, Standing::Listed, false),
        Decision::Proceed
    );
}

#[test]
fn a_delisted_holder_may_not_cancel_a_redemption_back_to_shares() {
    assert_eq!(
        lock_policy::decide(Exit::CancelRedeem, Standing::Delisted, false),
        Decision::Refuse
    );
}

#[test]
fn a_frozen_holders_redemption_is_held() {
    assert_eq!(
        lock_policy::decide(Exit::CancelRedeem, Standing::Frozen, false),
        Decision::Hold
    );
}

#[test]
fn in_a_wind_down_a_listed_holders_cancelled_redemption_joins_the_entitlement() {
    assert_eq!(
        lock_policy::decide(Exit::CancelRedeem, Standing::Listed, true),
        Decision::Surrender
    );
}

#[test]
fn in_a_wind_down_a_delisted_holders_cancelled_redemption_joins_the_entitlement() {
    assert_eq!(
        lock_policy::decide(Exit::CancelRedeem, Standing::Delisted, true),
        Decision::Surrender
    );
}

#[test]
fn in_a_wind_down_a_frozen_holders_redemption_is_held() {
    assert_eq!(
        lock_policy::decide(Exit::CancelRedeem, Standing::Frozen, true),
        Decision::Hold
    );
}

#[test]
fn a_listed_holder_may_cancel_a_deposit() {
    assert_eq!(
        in_and_out_of_a_wind_down(Exit::CancelDeposit, Standing::Listed),
        [Decision::Proceed; 2]
    );
}

#[test]
fn a_delisted_holder_may_cancel_a_deposit() {
    assert_eq!(
        in_and_out_of_a_wind_down(Exit::CancelDeposit, Standing::Delisted),
        [Decision::Proceed; 2]
    );
}

#[test]
fn a_frozen_holders_deposit_cancellation_is_held() {
    assert_eq!(
        in_and_out_of_a_wind_down(Exit::CancelDeposit, Standing::Frozen),
        [Decision::Hold; 2]
    );
}

#[test]
fn a_listed_holder_may_request_a_redemption() {
    assert_eq!(
        in_and_out_of_a_wind_down(Exit::RequestRedeem, Standing::Listed),
        [Decision::Proceed; 2]
    );
}

#[test]
fn a_delisted_holder_may_request_a_redemption() {
    assert_eq!(
        in_and_out_of_a_wind_down(Exit::RequestRedeem, Standing::Delisted),
        [Decision::Proceed; 2]
    );
}

#[test]
fn a_frozen_holders_redemption_request_is_held() {
    assert_eq!(
        in_and_out_of_a_wind_down(Exit::RequestRedeem, Standing::Frozen),
        [Decision::Hold; 2]
    );
}

#[test]
fn a_listed_holder_claims_the_redemption() {
    assert_eq!(
        in_and_out_of_a_wind_down(Exit::ClaimRedeem, Standing::Listed),
        [Decision::Proceed; 2]
    );
}

#[test]
fn a_delisted_holder_claims_the_redemption() {
    assert_eq!(
        in_and_out_of_a_wind_down(Exit::ClaimRedeem, Standing::Delisted),
        [Decision::Proceed; 2]
    );
}

#[test]
fn a_frozen_holders_redemption_claim_is_held() {
    assert_eq!(
        in_and_out_of_a_wind_down(Exit::ClaimRedeem, Standing::Frozen),
        [Decision::Hold; 2]
    );
}

#[test]
fn a_listed_holder_claims_the_wind_down() {
    assert_eq!(
        in_and_out_of_a_wind_down(Exit::ClaimWindDown, Standing::Listed),
        [Decision::Proceed; 2]
    );
}

#[test]
fn a_delisted_holder_claims_the_wind_down() {
    assert_eq!(
        in_and_out_of_a_wind_down(Exit::ClaimWindDown, Standing::Delisted),
        [Decision::Proceed; 2]
    );
}

#[test]
fn a_frozen_holders_wind_down_claim_is_held() {
    assert_eq!(
        in_and_out_of_a_wind_down(Exit::ClaimWindDown, Standing::Frozen),
        [Decision::Hold; 2]
    );
}

#[test]
fn a_frozen_holder_is_refused_as_frozen() {
    assert_eq!(
        lock_policy::refused_with(Standing::Frozen),
        VaultError::Frozen
    );
}

#[test]
fn a_delisted_holder_is_refused_as_not_allowlisted() {
    assert_eq!(
        lock_policy::refused_with(Standing::Delisted),
        VaultError::NotAllowlisted
    );
}

#[test]
fn standing_is_listed_for_an_allowlisted_holder() {
    let f = setup();
    let holder = f.investor(0);

    assert_eq!(
        f.e.as_contract(&f.vault.address, || lock_policy::standing(&f.e, &holder)),
        Standing::Listed
    );
}

#[test]
fn standing_is_delisted_for_an_address_that_was_never_allowlisted() {
    let f = setup();
    let stranger = f.unverified_investor(0);

    assert_eq!(
        f.e.as_contract(&f.vault.address, || lock_policy::standing(&f.e, &stranger)),
        Standing::Delisted
    );
}

#[test]
fn standing_is_delisted_for_a_holder_listed_then_removed() {
    let f = setup();
    let holder = f.investor(0);
    f.identity.allow(&holder, &false, &f.compliance);

    assert_eq!(
        f.e.as_contract(&f.vault.address, || lock_policy::standing(&f.e, &holder)),
        Standing::Delisted
    );
}

#[test]
fn standing_is_frozen_for_a_frozen_holder_on_the_allowlist() {
    let f = setup();
    let holder = f.investor(0);
    f.share.set_address_frozen(&holder, &true, &f.compliance);

    assert_eq!(
        f.e.as_contract(&f.vault.address, || lock_policy::standing(&f.e, &holder)),
        Standing::Frozen
    );
}

#[test]
fn standing_is_frozen_for_a_holder_both_frozen_and_delisted() {
    let f = setup();
    let holder = f.investor(0);
    f.identity.allow(&holder, &false, &f.compliance);
    f.share.set_address_frozen(&holder, &true, &f.compliance);

    assert_eq!(
        f.e.as_contract(&f.vault.address, || lock_policy::standing(&f.e, &holder)),
        Standing::Frozen
    );
}

#[test]
fn free_shares_is_the_full_balance_when_nothing_is_frozen() {
    let f = setup();
    let holder = f.holder(500);

    assert_eq!(
        f.e.as_contract(&f.vault.address, || lock_policy::free_shares(&f.e, &holder)),
        500
    );
}

#[test]
fn free_shares_excludes_a_partial_freeze() {
    let f = setup();
    let holder = f.holder(500);
    f.share.freeze_partial_tokens(&holder, &400, &f.compliance);

    assert_eq!(
        f.e.as_contract(&f.vault.address, || lock_policy::free_shares(&f.e, &holder)),
        100
    );
}
