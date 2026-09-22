use super::*;

#[test]
fn a_fresh_vault_has_no_notice() {
    let f = setup();

    assert_eq!(f.vault.notice(), 0);
}

#[test]
fn governance_sets_the_notice() {
    let f = setup();

    f.vault.set_notice(&3_600, &f.admin);

    assert_eq!(f.vault.notice(), 3_600);
}

#[test]
fn setting_the_notice_needs_governance_authorisation() {
    let f = setup();

    f.e.set_auths(&[]);
    assert!(f.vault.try_set_notice(&3_600, &f.admin).is_err());
    assert_eq!(f.vault.notice(), 0);

    f.e.mock_all_auths();
    f.vault.set_notice(&3_600, &f.admin);
    assert_eq!(f.vault.notice(), 3_600);
}

#[test]
fn an_open_epoch_has_no_timestamps() {
    let f = setup();
    let epoch = f.vault.get_epoch(&f.vault.current_epoch()).unwrap();

    assert_eq!(epoch.closed_at, 0);
    assert_eq!(epoch.priceable_at, 0);
}

#[test]
fn closing_records_the_moment_and_the_wait() {
    let f = setup();
    f.vault.set_notice(&3_600, &f.admin);
    let closed_at = f.e.ledger().timestamp();

    let id = f.close_epoch();

    let epoch = f.vault.get_epoch(&id).unwrap();
    assert_eq!(epoch.closed_at, closed_at);
    assert_eq!(epoch.priceable_at, closed_at + 3_600);
}

#[test]
fn a_later_notice_does_not_move_an_epoch_that_closed() {
    let f = setup();
    f.vault.set_notice(&3_600, &f.admin);
    let id = f.close_epoch();
    let before = f.vault.get_epoch(&id).unwrap().priceable_at;

    f.vault.set_notice(&86_400, &f.admin);

    assert_eq!(f.vault.get_epoch(&id).unwrap().priceable_at, before);
}

#[test]
fn an_epoch_cannot_be_priced_inside_its_notice() {
    let f = setup();
    let holder = f.holder(100);
    f.vault.set_notice(&3_600, &f.admin);
    f.vault.request_redeem(&holder, &100);
    let epoch = f.close_epoch();
    f.attest(wad(2));

    refused(
        f.vault.try_fulfill_epoch(&epoch),
        VaultError::NoticeNotElapsed,
    );
}

#[test]
fn it_is_priced_once_the_notice_elapses() {
    let f = setup();
    let holder = f.holder(100);
    f.vault.set_notice(&3_600, &f.admin);
    f.vault.request_redeem(&holder, &100);
    let epoch = f.close_epoch();

    f.advance(3_600);
    f.attest(wad(2));
    f.vault.fulfill_epoch(&epoch);

    assert_eq!(f.vault.get_epoch(&epoch).unwrap().share_price, wad(2));
}

#[test]
fn a_notice_of_zero_prices_as_soon_as_the_valuation_lands() {
    let f = setup();
    let holder = f.holder(100);
    f.vault.request_redeem(&holder, &100);
    let epoch = f.close_epoch();
    f.attest(wad(2));

    f.vault.fulfill_epoch(&epoch);

    assert_eq!(f.vault.get_epoch(&epoch).unwrap().share_price, wad(2));
}

#[test]
fn the_notice_is_reported_before_the_valuation() {
    let f = setup();
    let holder = f.holder(100);
    f.vault.set_notice(&3_600, &f.admin);
    f.vault.request_redeem(&holder, &100);
    f.advance(60);
    let epoch = f.close_epoch();

    // Neither rule is satisfied: the notice is running and the standing
    // valuation is before the close. The wait is the more useful answer.
    refused(
        f.vault.try_fulfill_epoch(&epoch),
        VaultError::NoticeNotElapsed,
    );
}

#[test]
fn the_notice_does_not_reopen_the_cancellation_window() {
    let f = setup();
    let investor = f.investor(1_000);
    f.vault.set_notice(&3_600, &f.admin);
    f.vault.request_deposit(&investor, &1_000);
    let epoch = f.close_epoch();
    f.attest(wad(2));

    // The price is readable even though the epoch cannot be priced yet, so
    // cancelling now would be declining a price already seen.
    refused(
        f.vault.try_cancel_deposit(&investor, &epoch),
        VaultError::PriceAvailable,
    );
    refused(
        f.vault.try_fulfill_epoch(&epoch),
        VaultError::NoticeNotElapsed,
    );
}

#[test]
fn a_notice_beyond_the_maximum_is_refused() {
    let f = setup();

    refused(
        f.vault.try_set_notice(&(MAX_NOTICE_SECS + 1), &f.admin),
        VaultError::NoticeTooLong,
    );
    assert_eq!(f.vault.notice(), 0);
}

#[test]
fn a_notice_above_the_upgrade_delay_is_refused() {
    let f = setup();

    refused(
        f.vault.try_set_notice(&(MIN_UPGRADE_DELAY + 1), &f.admin),
        VaultError::NoticeAboveUpgradeDelay,
    );
    assert_eq!(f.vault.notice(), 0);
}

#[test]
fn a_notice_at_the_maximum_is_accepted() {
    let f = setup();

    // The delay must be raised first, since notice cannot outgrow the upgrade delay.
    f.vault.propose_upgrade_delay(&MAX_NOTICE_SECS, &f.admin);
    f.advance(MIN_UPGRADE_DELAY);
    f.vault.apply_upgrade(&f.admin);

    f.vault.set_notice(&MAX_NOTICE_SECS, &f.admin);

    assert_eq!(f.vault.notice(), MAX_NOTICE_SECS);
}
