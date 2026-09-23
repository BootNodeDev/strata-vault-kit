use super::*;

#[test]
fn direct_unit_pricing_reads_oracle_nav() {
    let f = setup();
    f.attest(wad(2));

    let price = f.e.as_contract(&f.vault.address, || {
        DirectUnitPricing::resolve_share_price(&f.e).unwrap()
    });
    assert_eq!(price, wad(2));
}

#[test]
fn direct_unit_pricing_rejects_zero_or_negative_price() {
    let env = Env::default();
    // Non-positive share prices are refused by conversion methods
    assert_eq!(
        DirectUnitPricing::deposit_shares(&env, 100, 0),
        Err(VaultError::InvalidSharePrice)
    );
    assert_eq!(
        DirectUnitPricing::deposit_shares(&env, 100, -1),
        Err(VaultError::InvalidSharePrice)
    );
    assert_eq!(
        DirectUnitPricing::redeem_assets(&env, 100, 0),
        Err(VaultError::InvalidSharePrice)
    );
    assert_eq!(
        DirectUnitPricing::redeem_assets(&env, 100, -1),
        Err(VaultError::InvalidSharePrice)
    );
}

#[test]
fn derived_pricing_at_zero_supply_is_par() {
    let env = Env::default();
    let price = DerivedNetAssetPricing::calculate_share_price(&env, 0, 0, 0, 0).unwrap();
    assert_eq!(price, WAD_SCALE);

    // Any asset value with 0 supply starts at par
    let price_with_assets =
        DerivedNetAssetPricing::calculate_share_price(&env, 1_000_000, 500_000, 0, 0).unwrap();
    assert_eq!(price_with_assets, WAD_SCALE);
}

#[test]
fn derived_pricing_computes_exact_ratio() {
    let env = Env::default();

    // Net assets = 1000 + 200 - 100 = 1100. Supply = 1100. Price = 1.0 (WAD_SCALE)
    let p1 = DerivedNetAssetPricing::calculate_share_price(
        &env,
        1_000 * WAD_SCALE,
        200 * WAD_SCALE,
        100 * WAD_SCALE,
        1_100 * WAD_SCALE,
    )
    .unwrap();
    assert_eq!(p1, WAD_SCALE);

    // Net assets = 2000 + 500 - 300 = 2200. Supply = 1100. Price = 2.0 (2 * WAD_SCALE)
    let p2 = DerivedNetAssetPricing::calculate_share_price(
        &env,
        2_000 * WAD_SCALE,
        500 * WAD_SCALE,
        300 * WAD_SCALE,
        1_100 * WAD_SCALE,
    )
    .unwrap();
    assert_eq!(p2, 2 * WAD_SCALE);
}

#[test]
fn derived_pricing_rejects_insolvent_or_zero_net_assets() {
    let env = Env::default();

    // Liabilities equal to total assets (net assets = 0)
    assert_eq!(
        DerivedNetAssetPricing::calculate_share_price(&env, 1_000, 500, 1_500, 1_000),
        Err(VaultError::InvalidSharePrice)
    );

    // Liabilities strictly exceed total assets (net assets < 0)
    assert_eq!(
        DerivedNetAssetPricing::calculate_share_price(&env, 1_000, 500, 2_000, 1_000),
        Err(VaultError::InvalidSharePrice)
    );
}

#[test]
fn derived_pricing_rejects_overflow() {
    let env = Env::default();

    // Asset overflow in checked_add
    assert_eq!(
        DerivedNetAssetPricing::calculate_share_price(&env, i128::MAX, 1, 0, 1_000),
        Err(VaultError::AmountTooLarge)
    );

    // Net asset product overflow in checked_mul_div
    assert_eq!(
        DerivedNetAssetPricing::calculate_share_price(&env, i128::MAX / 2, 0, 0, 1),
        Err(VaultError::AmountTooLarge)
    );
}

#[test]
fn derived_pricing_preserves_monotonicity() {
    let env = Env::default();
    let base_attested = 10_000 * WAD_SCALE;
    let base_balance = 2_000 * WAD_SCALE;
    let base_liabilities = 1_000 * WAD_SCALE;
    let base_supply = 10_000 * WAD_SCALE;

    let base_price = DerivedNetAssetPricing::calculate_share_price(
        &env,
        base_attested,
        base_balance,
        base_liabilities,
        base_supply,
    )
    .unwrap();

    // 1. Increasing liabilities strictly reduces share price
    let higher_liabilities_price = DerivedNetAssetPricing::calculate_share_price(
        &env,
        base_attested,
        base_balance,
        base_liabilities + 500 * WAD_SCALE,
        base_supply,
    )
    .unwrap();
    assert!(higher_liabilities_price < base_price);

    // 2. Increasing balance strictly increases share price
    let higher_balance_price = DerivedNetAssetPricing::calculate_share_price(
        &env,
        base_attested,
        base_balance + 500 * WAD_SCALE,
        base_liabilities,
        base_supply,
    )
    .unwrap();
    assert!(higher_balance_price > base_price);

    // 3. Increasing supply strictly dilutes share price
    let higher_supply_price = DerivedNetAssetPricing::calculate_share_price(
        &env,
        base_attested,
        base_balance,
        base_liabilities,
        base_supply + 1_000 * WAD_SCALE,
    )
    .unwrap();
    assert!(higher_supply_price < base_price);
}

#[test]
fn conversions_round_down_in_vault_favour_and_preserve_value() {
    let env = Env::default();
    let prices = [
        wad(1) / 2,              // 0.5 NAV
        wad(1),                  // 1.0 par NAV
        3 * wad(1) / 2,          // 1.5 NAV
        wad(2),                  // 2.0 NAV
        1234567890123456789i128, // fractional irregular NAV
    ];

    let amounts = [1i128, 10, 100, 1_001, 100_000, 10_000_000_000];

    for &price in &prices {
        for &assets in &amounts {
            let shares = DirectUnitPricing::deposit_shares(&env, assets, price).unwrap();

            // Floor check for deposit: shares * price <= assets * WAD_SCALE
            assert!(
                shares * price <= assets * WAD_SCALE,
                "deposit minted too many shares: {shares} * {price} > {assets} * WAD"
            );

            // Round trip: redeeming shares should never yield more assets than deposited
            let redeemed = DirectUnitPricing::redeem_assets(&env, shares, price).unwrap();
            assert!(
                redeemed <= assets,
                "round-trip value created: {redeemed} > {assets}"
            );

            // Floor check for redeem: redeemed * WAD_SCALE <= shares * price
            assert!(
                redeemed * WAD_SCALE <= shares * price,
                "redeem paid out too many assets: {redeemed} * WAD > {shares} * {price}"
            );
        }
    }
}
