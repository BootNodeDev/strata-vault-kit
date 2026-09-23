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

#[test]
fn deposit_and_redeem_round_trip_never_manufactures_assets() {
    let env = Env::default();
    env.cost_estimate().budget().reset_unlimited();

    // Property holds across massive scale (up to 10^30), handled via I256 scaling.
    proptest!(|(
        assets in 0i128..=1_000_000_000_000_000_000_000_000_000_000i128,
        price in 1i128..=1_000_000_000_000_000_000_000_000_000_000i128,
    )| {
        if let Some(shares) = checked_mul_div_floor(&env, &assets, &WAD_SCALE, &price) {
            if let Some(back_assets) = checked_mul_div_floor(&env, &shares, &price, &WAD_SCALE) {
                // Invariant: round-trip through shares can never yield more assets than started.
                prop_assert!(back_assets <= assets);
            }
        }
    });
}

#[test]
fn redeem_and_deposit_round_trip_never_manufactures_shares() {
    let env = Env::default();
    env.cost_estimate().budget().reset_unlimited();

    proptest!(|(
        shares in 0i128..=1_000_000_000_000_000_000_000_000_000_000i128,
        price in 1i128..=1_000_000_000_000_000_000_000_000_000_000i128,
    )| {
        if let Some(assets) = checked_mul_div_floor(&env, &shares, &price, &WAD_SCALE) {
            if let Some(back_shares) = checked_mul_div_floor(&env, &assets, &WAD_SCALE, &price) {
                // Invariant: round-trip through assets can never yield more shares than started.
                prop_assert!(back_shares <= shares);
            }
        }
    });
}

#[test]
fn deposit_floor_is_strictly_tight() {
    let env = Env::default();
    env.cost_estimate().budget().reset_unlimited();

    proptest!(|(
        assets in 0i128..=1_000_000_000_000_000i128,
        price in 1i128..=1_000_000_000_000_000i128,
    )| {
        let shares = checked_mul_div_floor(&env, &assets, &WAD_SCALE, &price).unwrap();

        // Never mints more shares than backed by assets.
        prop_assert!(shares * price <= assets * WAD_SCALE);
        // Floor is tight: not a single additional share could be minted.
        prop_assert!((shares + 1) * price > assets * WAD_SCALE);
    });
}

#[test]
fn conversion_monotonicity_in_amount_and_price() {
    let env = Env::default();
    env.cost_estimate().budget().reset_unlimited();

    proptest!(|(
        a1 in 0i128..=1_000_000_000_000_000_000_000i128,
        a2 in 0i128..=1_000_000_000_000_000_000_000i128,
        p1 in 1i128..=1_000_000_000_000_000_000_000i128,
        p2 in 1i128..=1_000_000_000_000_000_000_000i128,
    )| {
        let (amin, amax) = if a1 <= a2 { (a1, a2) } else { (a2, a1) };
        let (pmin, pmax) = if p1 <= p2 { (p1, p2) } else { (p2, p1) };

        // Monotonic in amount:
        if let (Some(s_low), Some(s_high)) = (
            checked_mul_div_floor(&env, &amin, &WAD_SCALE, &pmin),
            checked_mul_div_floor(&env, &amax, &WAD_SCALE, &pmin),
        ) {
            prop_assert!(s_low <= s_high);
        }

        if let (Some(a_low), Some(a_high)) = (
            checked_mul_div_floor(&env, &amin, &pmin, &WAD_SCALE),
            checked_mul_div_floor(&env, &amax, &pmin, &WAD_SCALE),
        ) {
            prop_assert!(a_low <= a_high);
        }

        // Monotonic in price:
        if let (Some(s_cheap), Some(s_dear)) = (
            checked_mul_div_floor(&env, &amax, &WAD_SCALE, &pmin),
            checked_mul_div_floor(&env, &amax, &WAD_SCALE, &pmax),
        ) {
            prop_assert!(s_dear <= s_cheap);
        }

        if let (Some(a_cheap), Some(a_dear)) = (
            checked_mul_div_floor(&env, &amax, &pmin, &WAD_SCALE),
            checked_mul_div_floor(&env, &amax, &pmax, &WAD_SCALE),
        ) {
            prop_assert!(a_cheap <= a_dear);
        }
    });
}

#[test]
fn wind_down_pro_rata_sum_never_exceeds_pot() {
    let env = Env::default();
    env.cost_estimate().budget().reset_unlimited();

    proptest!(|(
        pot in 1i128..=1_000_000_000_000_000_000_000_000i128,
        e1 in 1i128..=1_000_000_000_000_000_000i128,
        e2 in 1i128..=1_000_000_000_000_000_000i128,
        e3 in 1i128..=1_000_000_000_000_000_000i128,
    )| {
        let snapshot = e1 + e2 + e3;
        let delta = checked_mul_div_floor(&env, &pot, &WAD_SCALE, &snapshot).unwrap();

        let c1 = checked_mul_div_floor(&env, &e1, &delta, &WAD_SCALE).unwrap();
        let c2 = checked_mul_div_floor(&env, &e2, &delta, &WAD_SCALE).unwrap();
        let c3 = checked_mul_div_floor(&env, &e3, &delta, &WAD_SCALE).unwrap();

        let total_paid = c1 + c2 + c3;
        // The vault can never overpay capital during wind-down distribution.
        prop_assert!(total_paid <= pot);
    });
}

#[test]
fn negative_control_ceil_division_violates_conservation() {
    // Demonstration that ceiling division allows arbitrage (value creation).
    // If an investor deposits 100 assets at price 3, ceil gives ceil(100 * 10 / 3) = 334.
    // Redeeming 334 shares at price 3 with ceil gives ceil(334 * 3 / 10) = 101 > 100!
    fn ceil_div(x: i128, y: i128) -> i128 {
        (x + y - 1) / y
    }

    let assets: i128 = 100;
    let price: i128 = 3;
    let scale: i128 = 10;

    let shares_ceil = ceil_div(assets * scale, price);
    let redeemed_ceil = ceil_div(shares_ceil * price, scale);

    // Ceil manufactures an extra asset unit (101 > 100):
    assert!(redeemed_ceil > assets);

    // In contrast, floor division guarantees non-inflationary conservation:
    let env = Env::default();
    let shares_floor = checked_mul_div_floor(&env, &assets, &scale, &price).unwrap();
    let redeemed_floor = checked_mul_div_floor(&env, &shares_floor, &price, &scale).unwrap();
    assert!(redeemed_floor <= assets);
}

// Bounded symbolic model checking harnesses for Kani (cbmc backend).
// When run under `cargo kani` (or `--features kani`), these verify the invariants symbolically.
#[cfg(feature = "kani")]
mod kani_proofs {
    #[kani::proof]
    fn prove_round_trip_deposit_redeem_conservation() {
        let assets: i128 = kani::any();
        let price: i128 = kani::any();
        let wad: i128 = 1_000_000_000_000_000_000;

        kani::assume(assets >= 0 && assets <= 1_000_000_000_000);
        kani::assume(price > 0 && price <= 1_000_000_000_000);

        let shares = (assets * wad) / price;
        let redeemed = (shares * price) / wad;

        assert!(redeemed <= assets);
    }

    #[kani::proof]
    fn prove_round_trip_redeem_deposit_conservation() {
        let shares: i128 = kani::any();
        let price: i128 = kani::any();
        let wad: i128 = 1_000_000_000_000_000_000;

        kani::assume(shares >= 0 && shares <= 1_000_000_000_000);
        kani::assume(price > 0 && price <= 1_000_000_000_000);

        let assets = (shares * price) / wad;
        let minted = (assets * wad) / price;

        assert!(minted <= shares);
    }

    #[kani::proof]
    fn prove_floor_tightness() {
        let assets: i128 = kani::any();
        let price: i128 = kani::any();
        let wad: i128 = 1_000_000_000_000_000_000;

        kani::assume(assets >= 0 && assets <= 1_000_000_000_000);
        kani::assume(price > 0 && price <= 1_000_000_000_000);

        let shares = (assets * wad) / price;

        assert!(shares * price <= assets * wad);
        assert!((shares + 1) * price > assets * wad);
    }
}
