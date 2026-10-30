use soroban_sdk::{testutils::Events as _, Event as _};

use super::*;
use crate::{
    DepositCancelled, DepositClaimed, DepositRefunded, DepositRequested, EpochClosed,
    EpochFulfilled, EpochReconciled, RedeemCancelled,
};

#[test]
fn requesting_a_deposit_publishes_the_request() {
    let f = setup();
    let user = f.investor(1_000);

    f.vault.request_deposit(&user, &400);

    assert_eq!(
        f.e.events().all().filter_by_contract(&f.vault.address),
        [DepositRequested {
            holder: user,
            epoch: 1,
            amount: 400,
        }
        .to_xdr(&f.e, &f.vault.address)]
    );
}

#[test]
fn closing_an_epoch_publishes_its_totals() {
    let f = setup();
    let user = f.investor(1_000);
    f.vault.request_deposit(&user, &400);

    f.close_epoch();

    assert_eq!(
        f.e.events().all().filter_by_contract(&f.vault.address),
        [EpochClosed {
            epoch: 1,
            total_deposited: 400,
            total_shares_redeeming: 0,
        }
        .to_xdr(&f.e, &f.vault.address)]
    );
}

#[test]
fn pricing_an_epoch_publishes_the_share_price() {
    let f = setup();
    let user = f.investor(1_000);
    f.vault.request_deposit(&user, &400);
    let epoch = f.close_epoch();
    f.attest(wad(2));

    let share_price = f.vault.fulfill_epoch(&epoch);

    assert_eq!(
        f.e.events().all().filter_by_contract(&f.vault.address),
        [EpochFulfilled {
            epoch,
            share_price,
            total_deposited: 400,
        }
        .to_xdr(&f.e, &f.vault.address)]
    );
}

#[test]
fn claiming_the_last_deposit_publishes_the_shares_paid_and_the_settlement() {
    let f = setup();
    let user = f.investor(1_000);
    f.vault.request_deposit(&user, &400);
    f.fulfill_epoch(wad(2));

    f.vault.claim_deposit(&user, &1);

    assert_eq!(
        f.e.events().all().filter_by_contract(&f.vault.address),
        [
            DepositClaimed {
                holder: user,
                epoch: 1,
                amount: 400,
                shares: 200,
            }
            .to_xdr(&f.e, &f.vault.address),
            EpochReconciled {
                epoch: 1,
                share_dust: 0,
                cash_dust: 0,
            }
            .to_xdr(&f.e, &f.vault.address),
        ]
    );
}

#[test]
fn cancelling_a_deposit_publishes_the_cancellation() {
    let f = setup();
    let user = f.investor(1_000);
    f.vault.request_deposit(&user, &400);

    f.vault.cancel_deposit(&user, &1);

    assert_eq!(
        f.e.events().all().filter_by_contract(&f.vault.address),
        [DepositCancelled {
            holder: user,
            epoch: 1,
            amount: 400,
        }
        .to_xdr(&f.e, &f.vault.address)]
    );
}

#[test]
fn a_deposit_priced_at_zero_shares_publishes_a_refund_not_a_cancellation() {
    let f = setup();
    let inv = f.investor(10);

    let epoch = f.vault.request_deposit(&inv, &1);
    f.close_epoch();
    f.attest(wad(4));
    f.vault.fulfill_epoch(&epoch);

    assert_eq!(f.vault.claim_deposit(&inv, &epoch), 0);

    let events = f.e.events().all().filter_by_contract(&f.vault.address);
    assert_eq!(
        events.events()[0],
        DepositRefunded {
            holder: inv.clone(),
            epoch: 1,
            amount: 1,
        }
        .to_xdr(&f.e, &f.vault.address)
    );
    assert!(!events.events().contains(
        &DepositCancelled {
            holder: inv,
            epoch: 1,
            amount: 1,
        }
        .to_xdr(&f.e, &f.vault.address)
    ));
}

#[test]
fn cancelling_a_redemption_publishes_the_cancellation() {
    let f = setup();
    let holder = f.holder(1_000);

    let epoch = f.vault.request_redeem(&holder, &100);
    f.vault.cancel_redeem(&holder, &epoch);

    assert_eq!(
        f.e.events().all().filter_by_contract(&f.vault.address),
        [RedeemCancelled {
            holder,
            epoch,
            shares: 100,
        }
        .to_xdr(&f.e, &f.vault.address)]
    );
}

#[test]
fn a_refused_call_publishes_nothing() {
    let f = setup();
    let user = f.investor(1_000);

    assert!(f.vault.try_request_deposit(&user, &0).is_err());

    assert_eq!(
        f.e.events()
            .all()
            .filter_by_contract(&f.vault.address)
            .events()
            .len(),
        0
    );
}
