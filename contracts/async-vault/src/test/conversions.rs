use super::*;

#[test]
fn a_fractional_share_price_is_representable() {
    let f = setup();
    let user = f.investor(1_000);

    f.vault.request_deposit(&user, &400);
    f.fulfill_epoch(3 * WAD_SCALE / 2);

    assert_eq!(f.vault.claim_deposit(&user, &1), 266);
    assert_eq!(f.shares(&user), 266);
}

#[test]
fn conversion_rounds_down_in_the_vaults_favour() {
    let f = setup();
    let user = f.investor(1_000);

    f.vault.request_deposit(&user, &401);
    f.fulfill_epoch(wad(2));

    assert_eq!(f.vault.claim_deposit(&user, &1), 200);
    assert_eq!(f.balance(&f.vault.address), 401);
}

#[test]
fn a_deposit_too_large_for_an_i128_product_still_converts() {
    let f = setup();
    let whale = f.investor(i128::MAX);
    let amount = 10i128.pow(30);

    f.vault.request_deposit(&whale, &amount);
    f.fulfill_epoch(wad(2));

    assert!(amount.checked_mul(WAD_SCALE).is_none());
    assert_eq!(f.vault.claim_deposit(&whale, &1), 5 * 10i128.pow(29));
}

#[test]
fn a_conversion_that_cannot_fit_i128_is_rejected() {
    let f = setup();
    let whale = f.investor(i128::MAX);

    f.vault.request_deposit(&whale, &(i128::MAX / 2));
    f.fulfill_epoch(1);

    assert!(f.vault.try_claim_deposit(&whale, &1).is_err());
    assert!(!f.vault.get_deposit_request(&1, &whale).unwrap().claimed);
}
