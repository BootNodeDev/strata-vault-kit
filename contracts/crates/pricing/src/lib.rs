#![cfg_attr(not(test), no_std)]

pub const NAV_SCALE: i128 = 1_000_000_000_000_000_000; // 1e18

pub fn deposit_shares(assets: i128, nav: i128) -> i128 {
    assets * NAV_SCALE / nav
}

pub fn redeem_assets(shares: i128, nav: i128) -> i128 {
    shares * nav / NAV_SCALE
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn deposit_at_par_is_one_to_one() {
        assert_eq!(deposit_shares(100, NAV_SCALE), 100);
    }

    #[test]
    fn redeem_at_par_is_one_to_one() {
        assert_eq!(redeem_assets(100, NAV_SCALE), 100);
    }

    #[test]
    fn deposit_then_redeem_never_returns_more_than_deposited() {
        let nav = 3 * NAV_SCALE / 2; // NAV = 1.5
        let assets_in = 100;
        let shares = deposit_shares(assets_in, nav); // floor(100·1e18 / 1.5e18) = 66
        let assets_out = redeem_assets(shares, nav); // floor(66·1.5e18 / 1e18)  = 99
        assert!(
            assets_out <= assets_in,
            "round-trip creó valor: {assets_out} > {assets_in}"
        );
    }

    #[test]
    #[should_panic(expected = "overflow")]
    fn deposit_shares_panics_on_extreme_amounts() {
        let _ = deposit_shares(i128::MAX, NAV_SCALE);
    }
}
