use proptest::prelude::*;
use soroban_sdk::{testutils::Events as _, Event as _};

use super::*;
use crate::{DepositConvertedToExit, EpochReconciled, RedemptionSurrendered};

/// A 400 deposit priced at 2.0 for 200 shares, then delisted before the claim.
fn delisted_with_a_priced_deposit(f: &Fixture) -> (Address, u64) {
    let investor = f.investor(1_000);
    let epoch = f.vault.request_deposit(&investor, &400);
    f.fulfill_epoch(wad(2));
    f.identity.allow(&investor, &false, &f.compliance);
    (investor, epoch)
}

#[test]
fn a_delisted_holders_priced_deposit_joins_their_redemption_in_the_open_epoch() {
    let f = setup();
    let (investor, epoch) = delisted_with_a_priced_deposit(&f);
    let open = f.vault.current_epoch();

    assert_eq!(f.vault.claim_deposit(&investor, &epoch), 0);

    assert_eq!(
        f.e.events().all().filter_by_contract(&f.vault.address),
        [
            DepositConvertedToExit {
                holder: investor.clone(),
                epoch,
                into_epoch: open,
                shares: 200,
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
    assert_eq!(f.shares(&investor), 0);
    assert_eq!(f.shares(&f.vault.address), 200);
    assert_eq!(f.vault.pending_mint_shares(), 0);
    assert_eq!(
        f.vault.get_redeem_request(&open, &investor).unwrap().shares,
        200
    );
    refused(
        f.vault.try_claim_deposit(&investor, &epoch),
        VaultError::AlreadyClaimed,
    );
}

/// A fall since her deposit priced is hers, as it would be for anyone leaving.
#[test]
fn the_delisted_holder_is_paid_at_the_next_epochs_price() {
    let f = setup();
    let (investor, epoch) = delisted_with_a_priced_deposit(&f);
    f.vault.claim_deposit(&investor, &epoch);

    let exit = f.fulfill_epoch(wad(8) / 5);

    assert_eq!(f.vault.claim_redeem(&investor, &exit), 320);
    assert_eq!(f.balance(&investor), 600 + 320);
}

#[test]
fn the_delisted_holder_exits_at_the_same_price_as_everyone_in_that_epoch() {
    let f = setup();
    let other = f.holder(200);
    let (investor, epoch) = delisted_with_a_priced_deposit(&f);
    f.vault.claim_deposit(&investor, &epoch);
    f.vault.request_redeem(&other, &200);

    let exit = f.fulfill_epoch(wad(8) / 5);

    assert_eq!(f.vault.claim_redeem(&investor, &exit), 320);
    assert_eq!(f.vault.claim_redeem(&other, &exit), 320);
}

#[test]
fn a_conversion_adds_to_a_redemption_already_open_in_the_epoch() {
    let f = setup();
    let investor = f.holder(100);
    StellarAssetClient::new(&f.e, &f.asset).mint(&investor, &400);
    let epoch = f.vault.request_deposit(&investor, &400);
    f.fulfill_epoch(wad(2));
    let open = f.vault.current_epoch();
    f.vault.request_redeem(&investor, &100);
    f.identity.allow(&investor, &false, &f.compliance);

    f.vault.claim_deposit(&investor, &epoch);

    assert_eq!(
        f.vault.get_redeem_request(&open, &investor).unwrap().shares,
        300
    );
    assert_eq!(
        f.vault.get_epoch(&open).unwrap().total_shares_redeeming,
        300
    );
    assert_eq!(f.vault.get_epoch_settlement(&open).unwrap().redeems_open, 1);
}

#[test]
fn in_a_wind_down_the_shares_are_credited_before_the_first_round() {
    let f = setup();
    let (investor, epoch) = delisted_with_a_priced_deposit(&f);
    f.vault.propose_wind_down(&f.admin);
    f.advance(MIN_WIND_DOWN_DELAY);
    f.vault.activate_wind_down();

    assert_eq!(f.vault.claim_deposit(&investor, &epoch), 0);
    assert_eq!(
        f.e.events().all().filter_by_contract(&f.vault.address),
        [
            DepositConvertedToExit {
                holder: investor.clone(),
                epoch,
                into_epoch: 0,
                shares: 200,
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
    assert_eq!(f.vault.finalize_wind_down_round(), 400);

    assert_eq!(f.vault.claim_wind_down(&investor), 400);
    assert_eq!(f.vault.wind_down_owed(), 0);
}

#[test]
fn in_a_wind_down_the_shares_are_credited_after_the_first_round() {
    let f = setup();
    let (investor, epoch) = delisted_with_a_priced_deposit(&f);
    f.vault.propose_wind_down(&f.admin);
    f.advance(MIN_WIND_DOWN_DELAY);
    f.vault.activate_wind_down();
    assert_eq!(f.vault.finalize_wind_down_round(), 400);

    f.vault.claim_deposit(&investor, &epoch);

    assert_eq!(f.vault.claim_wind_down(&investor), 400);
    assert_eq!(f.vault.wind_down_owed(), 0);
}

/// Without the credit in the snapshot, the first round would owe more than the vault holds.
#[test]
fn a_credit_before_the_first_round_leaves_every_holder_their_share() {
    let f = setup();
    let other = f.holder(200);
    let (investor, epoch) = delisted_with_a_priced_deposit(&f);
    f.vault.propose_wind_down(&f.admin);
    f.advance(MIN_WIND_DOWN_DELAY);
    f.vault.activate_wind_down();
    f.vault.claim_deposit(&investor, &epoch);

    assert_eq!(f.vault.finalize_wind_down_round(), 800);
    assert_eq!(f.vault.claim_wind_down(&investor), 400);
    assert_eq!(f.vault.claim_wind_down(&other), 400);
    assert_eq!(f.balance(&f.vault.address), 0);
}

#[test]
fn a_frozen_and_delisted_holders_claim_is_held() {
    let f = setup();
    let (investor, epoch) = delisted_with_a_priced_deposit(&f);
    f.share.set_address_frozen(&investor, &true, &f.compliance);

    refused(
        f.vault.try_claim_deposit(&investor, &epoch),
        VaultError::Frozen,
    );
    assert_eq!(f.vault.pending_mint_shares(), 200);
    assert!(
        !f.vault
            .get_deposit_request(&epoch, &investor)
            .unwrap()
            .claimed
    );
}

/// Converted while the wind-down was only proposed, the redemption will never be priced.
#[test]
fn a_conversion_caught_by_a_wind_down_is_paid_from_the_rounds() {
    let f = setup();
    let other = f.holder(200);
    let (investor, epoch) = delisted_with_a_priced_deposit(&f);
    f.vault.propose_wind_down(&f.admin);
    f.vault.claim_deposit(&investor, &epoch);
    let open = f.vault.current_epoch();
    f.advance(MIN_WIND_DOWN_DELAY);
    f.vault.activate_wind_down();

    assert_eq!(f.vault.cancel_redeem(&investor, &open), 200);

    assert_eq!(
        f.e.events().all().filter_by_contract(&f.vault.address),
        [RedemptionSurrendered {
            holder: investor.clone(),
            epoch: open,
            shares: 200,
        }
        .to_xdr(&f.e, &f.vault.address)]
    );
    assert_eq!(f.vault.get_redeem_request(&open, &investor), None);
    assert_eq!(f.shares(&f.vault.address), 0);
    assert_eq!(f.vault.finalize_wind_down_round(), 800);
    assert_eq!(f.vault.claim_wind_down(&investor), 400);
    assert_eq!(f.vault.claim_wind_down(&other), 400);
    assert_eq!(f.balance(&f.vault.address), 0);
}

#[test]
fn a_redemption_surrendered_after_the_first_round_keeps_the_rounds_solvent() {
    let f = setup();
    let other = f.holder(200);
    let (investor, epoch) = delisted_with_a_priced_deposit(&f);
    f.vault.propose_wind_down(&f.admin);
    f.vault.claim_deposit(&investor, &epoch);
    let open = f.vault.current_epoch();
    f.advance(MIN_WIND_DOWN_DELAY);
    f.vault.activate_wind_down();
    assert_eq!(f.vault.finalize_wind_down_round(), 800);

    f.vault.cancel_redeem(&investor, &open);

    assert_eq!(f.vault.claim_wind_down(&investor), 400);
    assert_eq!(f.vault.claim_wind_down(&other), 400);
    assert_eq!(f.vault.wind_down_owed(), 0);
}

#[test]
fn a_delisted_holders_unpriced_redemption_joins_the_wind_down_when_cancelled() {
    let f = setup();
    let investor = f.holder(200);
    let other = f.holder(200);
    let epoch = f.vault.request_redeem(&investor, &200);
    f.identity.allow(&investor, &false, &f.compliance);
    f.vault.propose_wind_down(&f.admin);
    f.advance(MIN_WIND_DOWN_DELAY);
    f.vault.activate_wind_down();

    assert_eq!(f.vault.cancel_redeem(&investor, &epoch), 200);

    assert_eq!(f.vault.finalize_wind_down_round(), 800);
    assert_eq!(f.vault.claim_wind_down(&investor), 400);
    assert_eq!(f.vault.claim_wind_down(&other), 400);
}

#[test]
fn a_conversion_waits_while_the_vault_is_delisted() {
    let f = setup();
    let investor = f.investor(1_000);
    let epoch = f.vault.request_deposit(&investor, &1_000);
    f.fulfill_epoch(wad(2));
    f.identity.allow(&investor, &false, &f.compliance);
    f.identity.allow(&f.vault.address, &false, &f.compliance);

    assert_eq!(
        f.vault.try_claim_deposit(&investor, &epoch),
        Err(Ok(soroban_sdk::Error::from_contract_error(304)))
    );
    assert!(f.vault.get_deposit_request(&epoch, &investor).is_some());

    f.identity.allow(&f.vault.address, &true, &f.compliance);
    assert_eq!(f.vault.claim_deposit(&investor, &epoch), 0);
    let open = f.vault.current_epoch();
    assert_eq!(
        f.vault.get_redeem_request(&open, &investor).unwrap().shares,
        500
    );
}

proptest! {
    #![proptest_config(ProptestConfig::with_cases(16))]

    /// Conversions in any order among the other claims still settle the epoch.
    #[test]
    fn conversions_settle_the_epoch_in_any_order(
        deposits in proptest::collection::vec(1i128..5_000, 1..5),
        delisted in proptest::collection::vec(any::<bool>(), 4),
        order in proptest::collection::vec(any::<u16>(), 4),
        price_tenths in 5i128..=20,
    ) {
        let f = setup();
        let investors: std::vec::Vec<Address> = deposits
            .iter()
            .map(|amount| {
                let who = f.investor(*amount);
                f.vault.request_deposit(&who, amount);
                who
            })
            .collect();
        let epoch = f.fulfill_epoch(wad(1) * price_tenths / 10);
        let open = f.vault.current_epoch();

        let mut claims: std::vec::Vec<(u16, usize)> =
            (0..investors.len()).map(|i| (order[i], i)).collect();
        claims.sort();
        let mut converted = 0i128;
        for (_, i) in claims {
            let who = &investors[i];
            if delisted[i] {
                f.identity.allow(who, &false, &f.compliance);
            }
            let queued = || f.vault.get_redeem_request(&open, who).map_or(0, |r| r.shares);
            let before = queued();
            let paid = f.vault.claim_deposit(who, &epoch);
            if delisted[i] {
                prop_assert_eq!(paid, 0);
                converted += queued() - before;
            }
        }

        let s = f.vault.get_epoch_settlement(&epoch).unwrap();
        prop_assert!(s.reconciled);
        prop_assert_eq!(f.vault.pending_mint_shares(), 0);
        prop_assert_eq!(
            f.vault.get_epoch(&open).unwrap().total_shares_redeeming,
            converted
        );
        prop_assert_eq!(f.shares(&f.vault.address), converted);
    }
}
