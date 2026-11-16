use proptest::prelude::*;
use soroban_sdk::{testutils::Events as _, Event as _};
use stellar_tokens::rwa::{compliance::ComplianceHook, RWAError};

use super::*;
use crate::{DepositClaimed, EpochFulfilled, EpochReconciled, RedeemCancelled, RedeemClaimed};

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
    assert!(s.reconciled());
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
    assert!(!f.vault.get_epoch_settlement(&epoch).unwrap().reconciled());
    assert_eq!(f.vault.committed(), 155);

    f.vault.claim_redeem(&b, &epoch);

    assert_eq!(
        f.e.events().all().filter_by_contract(&f.vault.address),
        [
            RedeemClaimed {
                holder: b,
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
    assert!(f.vault.get_epoch_settlement(&epoch).unwrap().reconciled());
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
    assert!(s.reconciled());
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
    assert!(s.reconciled());
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
    assert!(s.reconciled());
}

#[test]
#[should_panic(expected = "Error(Contract, #6070)")]
fn a_total_that_would_go_below_zero_fails_loudly() {
    let f = setup();
    f.e.as_contract(&f.vault.address, || crate::state::reduce(&f.e, 1, 2));
}

#[test]
fn a_settlement_total_that_would_overflow_fails_by_name() {
    let f = setup();
    let epoch = f.vault.current_epoch();
    let full = crate::EpochSettlement {
        deposits_open: u32::MAX,
        redeems_open: u32::MAX,
        shares_settled: i128::MAX,
        assets_settled: i128::MAX,
        ..Default::default()
    };
    f.e.as_contract(&f.vault.address, || {
        strata_storage::set_persistent(&f.e, &crate::keys::DataKey::Settlement(epoch), &full)
    });

    let steps: [&dyn Fn(); 4] = [
        &|| crate::settlement::on_deposit_requested(&f.e, epoch),
        &|| crate::settlement::on_redeem_requested(&f.e, epoch),
        &|| crate::settlement::on_deposit_claimed(&f.e, epoch, 1),
        &|| crate::settlement::on_redeem_claimed(&f.e, epoch, 1),
    ];
    for step in steps {
        assert_eq!(
            f.e.try_as_contract::<(), VaultError>(&f.vault.address, step),
            Err(Ok(VaultError::AmountTooLarge))
        );
    }
}

/// The vault holds 11, Carol's deposit of 1 among them. At 1.1 a share, ten
/// shares promise floor(11) = 11, but each claim of five pays floor(5.5) = 5.
/// Carol's 1 floors to no share, and the only cash for her refund is the unit
/// the two claims leave in `committed`.
#[test]
fn a_zero_share_refund_is_paid_once_its_epochs_redemptions_settle() {
    let f = setup();
    let alice = f.holder(5);
    let bob = f.holder(5);
    f.vault.deploy_to_custodian(&f.treasury, &10);
    let carol = f.investor(1);
    let epoch = f.vault.request_deposit(&carol, &1);
    f.vault.request_redeem(&alice, &5);
    f.vault.request_redeem(&bob, &5);
    f.fulfill_epoch(wad(11) / 10);
    assert_eq!(f.balance(&f.vault.address), 11);
    assert_eq!(f.vault.committed(), 11);

    assert_eq!(f.vault.claim_redeem(&alice, &epoch), 5);
    refused(
        f.vault.try_claim_deposit(&carol, &epoch),
        VaultError::ClaimNotCovered,
    );
    assert_eq!(f.vault.claim_redeem(&bob, &epoch), 5);
    assert_eq!(f.vault.committed(), 0);

    assert_eq!(f.vault.claim_deposit(&carol, &epoch), 0);
    assert_eq!(
        (f.balance(&alice), f.balance(&bob), f.balance(&carol)),
        (5, 5, 1)
    );
    assert_eq!(f.balance(&f.vault.address), 0);
    assert_eq!(f.vault.committed(), 0);
    assert_eq!(f.vault.pending_mint_shares(), 0);
}

struct MixedEpoch {
    epoch: u64,
    depositors: [(Address, i128); 2],
    redeemers: [(Address, i128); 2],
}

/// At 1.5 a share, deposits of 4 and 5 promise floor(6) = 6 shares and mint
/// floor(2.67) + floor(3.33) = 5; redemptions of 101 and 103 shares promise
/// floor(306) = 306 and pay floor(151.5) + floor(154.5) = 305. One unit of
/// remainder on each side.
fn mixed_epoch_with_a_remainder_on_each_side(f: &Fixture) -> MixedEpoch {
    let x = f.holder(101);
    let y = f.holder(103);
    let a = f.investor(4);
    let b = f.investor(5);
    let epoch = f.vault.request_deposit(&a, &4);
    f.vault.request_deposit(&b, &5);
    f.vault.request_redeem(&x, &101);
    f.vault.request_redeem(&y, &103);
    f.fulfill_epoch(wad(3) / 2);
    MixedEpoch {
        epoch,
        depositors: [(a, 2), (b, 3)],
        redeemers: [(x, 151), (y, 154)],
    }
}

#[test]
fn the_share_remainder_leaves_once_the_deposits_settle() {
    let f = setup();
    let m = mixed_epoch_with_a_remainder_on_each_side(&f);
    assert_eq!(
        (f.vault.pending_mint_shares(), f.vault.committed()),
        (6, 306)
    );

    for (who, shares) in &m.depositors {
        assert_eq!(f.vault.claim_deposit(who, &m.epoch), *shares);
    }
    assert_eq!(
        f.e.events().all().filter_by_contract(&f.vault.address),
        [
            DepositClaimed {
                holder: m.depositors[1].0.clone(),
                epoch: m.epoch,
                amount: 5,
                shares: 3,
            }
            .to_xdr(&f.e, &f.vault.address),
            EpochReconciled {
                epoch: m.epoch,
                share_dust: 1,
                cash_dust: 0,
            }
            .to_xdr(&f.e, &f.vault.address),
        ]
    );
    assert_eq!(
        (f.vault.pending_mint_shares(), f.vault.committed()),
        (0, 306)
    );
    let s = f.vault.get_epoch_settlement(&m.epoch).unwrap();
    assert!(s.shares_reconciled && !s.cash_reconciled);

    for (who, assets) in &m.redeemers {
        assert_eq!(f.vault.claim_redeem(who, &m.epoch), *assets);
    }
    assert_eq!(
        f.e.events().all().filter_by_contract(&f.vault.address),
        [
            RedeemClaimed {
                holder: m.redeemers[1].0.clone(),
                epoch: m.epoch,
                shares: 103,
                assets: 154,
            }
            .to_xdr(&f.e, &f.vault.address),
            EpochReconciled {
                epoch: m.epoch,
                share_dust: 0,
                cash_dust: 1,
            }
            .to_xdr(&f.e, &f.vault.address),
        ]
    );
    assert_eq!((f.vault.pending_mint_shares(), f.vault.committed()), (0, 0));
}

#[test]
fn the_cash_remainder_leaves_once_the_redemptions_settle() {
    let f = setup();
    let m = mixed_epoch_with_a_remainder_on_each_side(&f);

    for (who, assets) in &m.redeemers {
        assert_eq!(f.vault.claim_redeem(who, &m.epoch), *assets);
    }
    assert_eq!((f.vault.pending_mint_shares(), f.vault.committed()), (6, 0));
    let s = f.vault.get_epoch_settlement(&m.epoch).unwrap();
    assert!(s.cash_reconciled && !s.shares_reconciled);

    for (who, shares) in &m.depositors {
        assert_eq!(f.vault.claim_deposit(who, &m.epoch), *shares);
    }
    assert_eq!((f.vault.pending_mint_shares(), f.vault.committed()), (0, 0));
}

/// A later epoch, priced and unclaimed, keeps its own totals. A remainder
/// taken from them twice would show as a shortfall there.
#[test]
fn each_remainder_leaves_once_whichever_side_settles_last() {
    for deposits_first in [true, false] {
        let f = setup();
        let z = f.holder(7);
        let m = mixed_epoch_with_a_remainder_on_each_side(&f);
        let c = f.investor(9);
        let later = f.vault.request_deposit(&c, &9);
        f.vault.request_redeem(&z, &7);
        f.fulfill_epoch(wad(3) / 2);
        let (later_mint, later_owed) = (6, 10);
        assert_eq!(f.vault.pending_mint_shares(), 6 + later_mint);
        assert_eq!(f.vault.committed(), 306 + later_owed);
        let held = f.balance(&f.vault.address);

        let claim_deposits = || {
            for (who, shares) in &m.depositors {
                assert_eq!(f.vault.claim_deposit(who, &m.epoch), *shares);
            }
        };
        let claim_redemptions = || {
            for (who, assets) in &m.redeemers {
                assert_eq!(f.vault.claim_redeem(who, &m.epoch), *assets);
            }
        };
        if deposits_first {
            claim_deposits();
            claim_redemptions();
        } else {
            claim_redemptions();
            claim_deposits();
        }

        assert_eq!(f.vault.pending_mint_shares(), later_mint);
        assert_eq!(f.vault.committed(), later_owed);
        assert_eq!(f.balance(&f.vault.address), held - 305);
        assert_eq!(f.vault.claim_deposit(&c, &later), 6);
        assert_eq!(f.vault.claim_redeem(&z, &later), 10);
        assert_eq!((f.vault.pending_mint_shares(), f.vault.committed()), (0, 0));
    }
}

/// At half a unit a share, redemptions of 1, 1 and 3 shares promise
/// floor(2.5) = 2 and pay 0, 0 and 1. The delisted holder cannot take a share
/// back, so the claim burns it, as a wind-down claim does; the listed holder
/// gets theirs back.
#[test]
fn a_zero_asset_redemption_the_holder_cannot_take_back_burns_and_settles() {
    let f = setup();
    let delisted = f.holder(1);
    let listed = f.holder(1);
    let paid = f.holder(3);
    let epoch = f.vault.request_redeem(&delisted, &1);
    f.vault.request_redeem(&listed, &1);
    f.vault.request_redeem(&paid, &3);
    f.fulfill_epoch(wad(1) / 2);
    f.identity.allow(&delisted, &false);
    let supply = f.share.total_supply();

    assert_eq!(f.vault.claim_redeem(&delisted, &epoch), 0);

    assert_eq!(
        f.e.events().all().filter_by_contract(&f.vault.address),
        [RedeemClaimed {
            holder: delisted.clone(),
            epoch,
            shares: 1,
            assets: 0,
        }
        .to_xdr(&f.e, &f.vault.address)]
    );
    assert_eq!(f.shares(&delisted), 0);
    assert_eq!(f.share.total_supply(), supply - 1);
    assert_eq!(f.shares(&f.vault.address), 4);
    assert_eq!(f.vault.pending_burn_shares(), 4);
    assert!(
        f.vault
            .get_redeem_request(&epoch, &delisted)
            .unwrap()
            .claimed
    );
    assert_eq!(
        f.vault.get_epoch_settlement(&epoch).unwrap().redeems_open,
        2
    );
    refused(
        f.vault.try_claim_redeem(&delisted, &epoch),
        VaultError::AlreadyClaimed,
    );

    assert_eq!(f.vault.claim_redeem(&listed, &epoch), 0);
    assert_eq!(
        f.e.events().all().filter_by_contract(&f.vault.address),
        [RedeemCancelled {
            holder: listed.clone(),
            epoch,
            shares: 1,
        }
        .to_xdr(&f.e, &f.vault.address)]
    );
    assert_eq!(f.shares(&listed), 1);
    assert_eq!(f.vault.claim_redeem(&paid, &epoch), 1);

    let s = f.vault.get_epoch_settlement(&epoch).unwrap();
    assert_eq!(s.redeems_open, 0);
    assert_eq!((s.assets_promised, s.assets_settled), (2, 1));
    assert_eq!(f.vault.committed(), 0);
    assert_eq!(f.vault.pending_burn_shares(), 0);
    assert_eq!(f.shares(&f.vault.address), 0);
    assert_eq!(f.share.total_supply(), supply - 1 - 3);
}

/// A request that can never settle: a compliance module refuses a priced
/// deposit's mint even for an allowlisted investor. This is not rounding
/// dust: the mint reverts, so the whole entitlement this deposit promised —
/// all 200 shares, for 400 assets at a price of 2 — stays in
/// `pending_mint_shares` until the mint is allowed. The epoch has no
/// redemption, so its cash side is already released.
#[test]
fn a_refused_mint_keeps_a_priced_deposit_epoch_open() {
    let f = setup();
    let investor = f.investor(1_000);
    let epoch = f.vault.request_deposit(&investor, &400);
    f.fulfill_epoch(wad(2));

    let module = f.e.register(super::compliance::RefusesEveryMint, ());
    f.add_compliance_module(ComplianceHook::CanCreate, &module);

    assert_eq!(
        f.vault.try_claim_deposit(&investor, &epoch),
        Err(Ok(RWAError::MintNotCompliant.into()))
    );

    assert_eq!(f.vault.pending_mint_shares(), 200);
    let s = f.vault.get_epoch_settlement(&epoch).unwrap();
    assert_eq!((s.shares_promised, s.shares_settled), (200, 0));
    assert_eq!(s.deposits_open, 1);
    assert!(!s.shares_reconciled);
    assert!(s.cash_reconciled);
}

proptest! {
    #![proptest_config(ProptestConfig::with_cases(24))]

    /// Any mix of deposits, cancellations, redemptions, refunds, zero-asset
    /// claims and delisted redeemers, claimed in any order while a later
    /// epoch stays unclaimed. After every claim each side's remainder is in
    /// the totals exactly until that side's last request settles. Once every
    /// request settles the totals hold only the later epoch's, and the vault
    /// holds what it held less what it paid.
    #[test]
    fn a_settled_epoch_leaves_no_remainder_in_the_totals(
        deposits in proptest::collection::vec(prop_oneof![Just(1i128), 1i128..5_000], 1..5),
        cancels in proptest::collection::vec(any::<bool>(), 5),
        redeems in proptest::collection::vec(prop_oneof![Just(1i128), 1i128..500], 0..4),
        delists in proptest::collection::vec(any::<bool>(), 4),
        price_tenths in 5i128..=20,
        order in proptest::collection::vec(any::<u16>(), 8),
    ) {
        let f = setup();
        let holders: std::vec::Vec<(Address, i128)> =
            redeems.iter().map(|shares| (f.holder(*shares), *shares)).collect();
        let later_redeemer = f.holder(7);
        let mut investors = std::vec::Vec::new();
        for (i, amount) in deposits.iter().enumerate() {
            let who = f.investor(*amount);
            let epoch = f.vault.request_deposit(&who, amount);
            if cancels[i] {
                f.vault.cancel_deposit(&who, &epoch);
            } else {
                investors.push((who, *amount));
            }
        }
        for (who, shares) in &holders {
            f.vault.request_redeem(who, shares);
        }
        let price = wad(1) * price_tenths / 10;
        let epoch = f.fulfill_epoch(price);

        let later_investor = f.investor(9);
        let later = f.vault.request_deposit(&later_investor, &9);
        f.vault.request_redeem(&later_redeemer, &7);
        f.fulfill_epoch(price);
        let l = f.vault.get_epoch_settlement(&later).unwrap();
        let (later_mint, later_owed) = (l.shares_promised, l.assets_promised);
        let held = f.balance(&f.vault.address);

        for (i, (who, _)) in holders.iter().enumerate() {
            if delists[i] {
                f.identity.allow(who, &false);
            }
        }

        let mut claims: std::vec::Vec<(u16, bool, &Address, i128)> = investors
            .iter()
            .map(|(who, amount)| (true, who, *amount))
            .chain(holders.iter().map(|(who, _)| (false, who, 0)))
            .enumerate()
            .map(|(i, (is_deposit, who, amount))| (order[i], is_deposit, who, amount))
            .collect();
        claims.sort_by_key(|(key, _, _, _)| *key);
        let mut paid = 0;
        for (_, is_deposit, who, amount) in claims {
            if is_deposit {
                if f.vault.claim_deposit(who, &epoch) == 0 {
                    paid += amount;
                }
            } else {
                paid += f.vault.claim_redeem(who, &epoch);
            }

            let s = f.vault.get_epoch_settlement(&epoch).unwrap();
            prop_assert_eq!(s.shares_reconciled, s.deposits_open == 0);
            prop_assert_eq!(s.cash_reconciled, s.redeems_open == 0);
            let share_left = if s.shares_reconciled { 0 } else { s.shares_promised - s.shares_settled };
            let cash_left = if s.cash_reconciled { 0 } else { s.assets_promised - s.assets_settled };
            prop_assert_eq!(f.vault.pending_mint_shares(), later_mint + share_left);
            prop_assert_eq!(f.vault.committed(), later_owed + cash_left);
        }

        let s = f.vault.get_epoch_settlement(&epoch).unwrap();
        prop_assert!(s.reconciled());
        prop_assert!(s.shares_settled <= s.shares_promised);
        prop_assert!(s.assets_settled <= s.assets_promised);
        prop_assert_eq!(f.vault.pending_mint_shares(), later_mint);
        prop_assert_eq!(f.vault.committed(), later_owed);
        prop_assert_eq!(f.vault.pending_burn_shares(), 7);
        prop_assert_eq!(f.vault.cancellable_escrow(), 0);
        prop_assert_eq!(f.balance(&f.vault.address), held - paid);
    }
}
