use proptest::prelude::*;
use soroban_sdk::{testutils::Events as _, Event as _};

use super::*;
use crate::{EpochFulfilled, EpochReconciled, RedeemClaimed};

/// Three assets a share: deposits of 4 and 5 promise floor(9 / 3) = 3 shares,
/// but each claim floors to 1.
#[test]
fn the_last_deposit_claim_clears_the_share_remainder() {
    let f = setup();
    let a = f.investor(4);
    let b = f.investor(5);
    f.vault.request_deposit(&a, &4);
    f.vault.request_deposit(&b, &5);
    let epoch = f.fulfill_epoch(wad(3));
    assert_eq!(f.vault.pending_mint_shares(), 3);

    assert_eq!(f.vault.claim_deposit(&a, &epoch), 1);
    assert_eq!(f.vault.pending_mint_shares(), 2);
    assert_eq!(f.vault.claim_deposit(&b, &epoch), 1);

    assert_eq!(f.vault.pending_mint_shares(), 0);
    let s = f.vault.get_epoch_settlement(&epoch).unwrap();
    assert!(s.reconciled);
    assert_eq!((s.shares_promised, s.shares_settled), (3, 2));
}

/// At 1.5 assets a share, 101 and 103 shares promise floor(306) = 306 assets
/// but pay floor(151.5) + floor(154.5) = 305.
#[test]
fn the_last_redemption_claim_clears_the_cash_remainder_and_says_so_once() {
    let f = setup();
    let a = f.holder(101);
    let b = f.holder(103);
    f.vault.request_redeem(&a, &101);
    f.vault.request_redeem(&b, &103);
    let epoch = f.fulfill_epoch(wad(3) / 2);
    assert_eq!(f.vault.committed(), 306);

    f.vault.claim_redeem(&a, &epoch);
    assert!(!f.vault.get_epoch_settlement(&epoch).unwrap().reconciled);
    assert_eq!(f.vault.committed(), 155);

    f.vault.claim_redeem(&b, &epoch);

    assert_eq!(
        f.e.events().all().filter_by_contract(&f.vault.address),
        [
            RedeemClaimed {
                controller: b,
                epoch,
                shares: 103,
                assets: 154,
            }
            .to_xdr(&f.e, &f.vault.address),
            EpochReconciled {
                epoch,
                share_dust: 0,
                cash_dust: 1,
            }
            .to_xdr(&f.e, &f.vault.address),
        ]
    );
    assert_eq!(f.vault.committed(), 0);
}

#[test]
fn an_epoch_with_no_requests_settles_when_it_is_priced() {
    let f = setup();
    let epoch = f.close_epoch();
    f.attest(wad(2));

    f.vault.fulfill_epoch(&epoch);

    assert_eq!(
        f.e.events().all().filter_by_contract(&f.vault.address),
        [
            EpochFulfilled {
                epoch,
                share_price: wad(2),
                total_deposited: 0,
            }
            .to_xdr(&f.e, &f.vault.address),
            EpochReconciled {
                epoch,
                share_dust: 0,
                cash_dust: 0,
            }
            .to_xdr(&f.e, &f.vault.address),
        ]
    );
    assert!(f.vault.get_epoch_settlement(&epoch).unwrap().reconciled);
}

#[test]
fn a_cancelled_request_does_not_hold_the_epoch_open() {
    let f = setup();
    let a = f.investor(400);
    let epoch = f.vault.request_deposit(&a, &400);
    f.vault.cancel_deposit(&a, &epoch);

    f.fulfill_epoch(wad(2));

    let s = f.vault.get_epoch_settlement(&epoch).unwrap();
    assert_eq!(s.deposits_open, 0);
    assert!(s.reconciled);
}

/// At two assets a share, deposits of 1 and 3 promise floor(4 / 2) = 2 shares.
/// The first claim floors to nothing and is refunded; the second gets 1.
#[test]
fn a_deposit_refunded_at_claim_counts_as_settled() {
    let f = setup();
    let a = f.investor(1);
    let b = f.investor(3);
    let epoch = f.vault.request_deposit(&a, &1);
    f.vault.request_deposit(&b, &3);
    f.fulfill_epoch(wad(2));

    assert_eq!(f.vault.claim_deposit(&a, &epoch), 0);
    assert_eq!(f.vault.claim_deposit(&b, &epoch), 1);

    assert_eq!(f.vault.pending_mint_shares(), 0);
    let s = f.vault.get_epoch_settlement(&epoch).unwrap();
    assert_eq!((s.shares_promised, s.shares_settled), (2, 1));
    assert!(s.reconciled);
}

#[test]
fn a_redemption_that_pays_nothing_counts_as_settled() {
    let f = setup();
    let a = f.holder(1);
    let epoch = f.vault.request_redeem(&a, &1);
    f.fulfill_epoch(wad(1) / 2);

    assert_eq!(f.vault.claim_redeem(&a, &epoch), 0);

    assert_eq!(f.shares(&a), 1);
    let s = f.vault.get_epoch_settlement(&epoch).unwrap();
    assert_eq!(
        (s.assets_promised, s.assets_settled, s.redeems_open),
        (0, 0, 0)
    );
    assert!(s.reconciled);
}

#[test]
#[should_panic(expected = "Error(Contract, #6070)")]
fn a_total_that_would_go_below_zero_fails_loudly() {
    let f = setup();
    f.e.as_contract(&f.vault.address, || crate::state::reduce(&f.e, 1, 2));
}

/// A request that can never settle holds its epoch open, so the remainder
/// stays in the totals. Here the redemption pays nothing and the holder, since
/// delisted, cannot take the shares back.
#[test]
fn a_request_that_cannot_settle_keeps_its_epoch_open() {
    let f = setup();
    let a = f.holder(1);
    let b = f.holder(3);
    let epoch = f.vault.request_redeem(&a, &1);
    f.vault.request_redeem(&b, &3);
    f.fulfill_epoch(wad(1) / 2);
    f.identity.allow(&a, &false, &f.compliance);

    assert_eq!(
        f.vault.try_claim_redeem(&a, &epoch).err(),
        Some(Ok(soroban_sdk::Error::from_contract_error(304)))
    );
    assert_eq!(f.vault.claim_redeem(&b, &epoch), 1);

    let s = f.vault.get_epoch_settlement(&epoch).unwrap();
    assert_eq!(s.redeems_open, 1);
    assert!(!s.reconciled);
    assert_eq!(f.vault.committed(), s.assets_promised - s.assets_settled);
}

proptest! {
    #![proptest_config(ProptestConfig::with_cases(24))]

    /// Any mix of deposits, cancellations, redemptions, refunds and
    /// zero-asset claims, claimed in any order, leaves nothing behind once
    /// every request settles.
    #[test]
    fn a_settled_epoch_leaves_no_remainder_in_the_totals(
        deposits in proptest::collection::vec(1i128..5_000, 1..5),
        cancels in proptest::collection::vec(any::<bool>(), 5),
        redeems in proptest::collection::vec(1i128..500, 0..4),
        price_tenths in 5i128..=20,
        order in proptest::collection::vec(any::<u16>(), 8),
    ) {
        let f = setup();
        let holders: std::vec::Vec<(Address, i128)> =
            redeems.iter().map(|shares| (f.holder(*shares), *shares)).collect();
        let mut investors = std::vec::Vec::new();
        for (i, amount) in deposits.iter().enumerate() {
            let who = f.investor(*amount);
            let epoch = f.vault.request_deposit(&who, amount);
            if cancels[i] {
                f.vault.cancel_deposit(&who, &epoch);
            } else {
                investors.push(who);
            }
        }
        for (who, shares) in &holders {
            f.vault.request_redeem(who, shares);
        }
        let epoch = f.fulfill_epoch(wad(1) * price_tenths / 10);

        let mut claims: std::vec::Vec<(u16, bool, &Address)> = investors
            .iter()
            .map(|who| (true, who))
            .chain(holders.iter().map(|(who, _)| (false, who)))
            .enumerate()
            .map(|(i, (is_deposit, who))| (order[i], is_deposit, who))
            .collect();
        claims.sort_by_key(|(key, _, _)| *key);
        for (_, is_deposit, who) in claims {
            if is_deposit {
                f.vault.claim_deposit(who, &epoch);
            } else {
                f.vault.claim_redeem(who, &epoch);
            }
        }

        let s = f.vault.get_epoch_settlement(&epoch).unwrap();
        prop_assert!(s.reconciled);
        prop_assert!(s.shares_settled <= s.shares_promised);
        prop_assert!(s.assets_settled <= s.assets_promised);
        prop_assert_eq!(f.vault.pending_mint_shares(), 0);
        prop_assert_eq!(f.vault.committed(), 0);
        prop_assert_eq!(f.vault.cancellable_escrow(), 0);
    }
}
