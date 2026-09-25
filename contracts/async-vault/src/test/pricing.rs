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
