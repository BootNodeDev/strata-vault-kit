use soroban_sdk::{testutils::Events as _, Event as _};

use super::*;
use crate::{DepositClaimed, DepositRequested, EpochClosed, EpochFulfilled};

#[test]
fn requesting_a_deposit_publishes_the_request() {
    let f = setup();
    let user = f.investor(1_000);

    f.vault.request_deposit(&user, &400);

    assert_eq!(
        f.e.events().all().filter_by_contract(&f.vault.address),
        [DepositRequested {
            controller: user,
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
fn claiming_a_deposit_publishes_the_shares_paid() {
    let f = setup();
    let user = f.investor(1_000);
    f.vault.request_deposit(&user, &400);
    f.fulfill_epoch(wad(2));

    f.vault.claim_deposit(&user, &1);

    assert_eq!(
        f.e.events().all().filter_by_contract(&f.vault.address),
        [DepositClaimed {
            controller: user,
            epoch: 1,
            amount: 400,
            shares: 200,
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
