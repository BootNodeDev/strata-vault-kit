use super::*;
use proptest::prelude::*;
use stellar_contract_utils::math::i128_fixed_point::checked_mul_div_floor;

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
    let epoch = f.close_epoch();
    f.attest(1);

    refused(
        f.vault.try_fulfill_epoch(&epoch),
        VaultError::AmountTooLarge,
    );
}

#[test]
fn conversion_arithmetic_holds_its_rounding_direction() {
    let env = Env::default();
    env.cost_estimate().budget().reset_unlimited();

    // Inputs are capped at 10^15 so products fit i128 without overflow.
    // The property is scale-independent.
    proptest!(|(
        shares in 0i128..=1_000_000_000_000_000i128,
        price in 1i128..=1_000_000_000_000_000i128,
    )| {
        let assets = checked_mul_div_floor(&env, &shares, &price, &WAD_SCALE).unwrap();

        // The vault never pays out more than the exact rational amount.
        prop_assert!(assets * WAD_SCALE <= shares * price);
        // And never less than it has to: the floor is tight.
        prop_assert!((assets + 1) * WAD_SCALE > shares * price);
        // Depositing and redeeming straight back never manufactures value.
        let back = checked_mul_div_floor(&env, &assets, &WAD_SCALE, &price).unwrap();
        prop_assert!(back <= shares);
    });
}
