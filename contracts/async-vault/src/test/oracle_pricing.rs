use super::*;

#[test]
fn fulfill_is_rejected_before_the_first_attestation() {
    let f = setup();
    f.close_epoch();

    refused(f.vault.try_fulfill_epoch(&1), VaultError::FeedNotValid);
    assert_eq!(f.vault.get_epoch(&1).unwrap().status, EpochStatus::Pending);
}

#[test]
fn fulfill_is_rejected_while_the_ripcord_is_raised() {
    let f = setup();
    f.close_epoch();
    f.attest(wad(2));
    f.oracle.set_ripcord(&true, &f.admin);

    refused(f.vault.try_fulfill_epoch(&1), VaultError::FeedNotValid);

    f.oracle.set_ripcord(&false, &f.admin);
    assert_eq!(f.vault.fulfill_epoch(&1), wad(2));
}

#[test]
fn fulfill_is_rejected_once_the_feed_goes_stale() {
    let f = setup();
    f.close_epoch();
    f.attest(wad(2));

    f.e.ledger().set_timestamp(10_000 + 3_601);
    assert!(f.oracle.is_stale());
    refused(f.vault.try_fulfill_epoch(&1), VaultError::FeedNotValid);
    assert_eq!(f.vault.get_epoch(&1).unwrap().status, EpochStatus::Pending);
}

#[test]
fn the_epoch_is_priced_at_the_attestation() {
    let f = setup();
    f.close_epoch();
    f.attest(3 * WAD_SCALE / 2);

    f.vault.fulfill_epoch(&1);

    assert_eq!(
        f.vault.get_epoch(&1).unwrap().share_price,
        3 * WAD_SCALE / 2
    );
    assert_eq!(f.oracle.nav_per_share(), 3 * WAD_SCALE / 2);
}

#[test]
fn a_paused_feed_is_refused_by_the_vault_not_the_oracle() {
    let f = setup();
    let holder = f.holder(100);
    f.vault.request_redeem(&holder, &100);
    let epoch = f.close_epoch();

    f.oracle.raise_ripcord(&f.guardian);

    refused(f.vault.try_fulfill_epoch(&epoch), VaultError::FeedNotValid);
}

#[test]
fn an_epoch_is_not_priced_against_a_valuation_older_than_its_close() {
    let f = setup();
    let holder = f.holder(100);
    f.attest(wad(3));
    f.vault.request_redeem(&holder, &100);

    f.advance(60);
    let epoch = f.close_epoch();

    refused(
        f.vault.try_fulfill_epoch(&epoch),
        VaultError::AttestationBeforeClose,
    );
}

#[test]
fn a_valuation_that_lands_after_the_close_prices_the_epoch() {
    let f = setup();
    let holder = f.holder(100);
    f.vault.request_redeem(&holder, &100);

    f.advance(60);
    let epoch = f.close_epoch();
    f.advance(60);
    f.attest(wad(3));

    f.vault.fulfill_epoch(&epoch);

    assert_eq!(f.vault.get_epoch(&epoch).unwrap().share_price, wad(3));
}

#[test]
fn a_valuation_taken_in_the_closing_ledger_prices_the_epoch() {
    let f = setup();
    let holder = f.holder(100);
    f.vault.request_redeem(&holder, &100);

    let epoch = f.close_epoch();
    f.attest(wad(3));

    f.vault.fulfill_epoch(&epoch);

    assert_eq!(f.vault.get_epoch(&epoch).unwrap().share_price, wad(3));
}

#[test]
fn a_stale_valuation_no_longer_closes_the_cancellation_window() {
    let f = setup();
    let investor = f.investor(1_000);
    f.vault.request_deposit(&investor, &1_000);

    f.advance(60);
    let epoch = f.close_epoch();

    // The feed is valid, but its valuation is before the close, so the price is
    // not readable and the escape hatch is still open.
    assert_eq!(f.vault.cancel_deposit(&investor, &epoch), 1_000);
}
