#![cfg_attr(not(test), no_std)]

pub const NAV_SCALE: i128 = 1_000_000_000_000_000_000; // 1e18

pub fn deposit_shares(assets: i128, nav: i128) -> i128 {
    assets * NAV_SCALE / nav
}

pub fn redeem_assets(shares: i128, nav: i128) -> i128 {
    shares * nav / NAV_SCALE
}

#[cfg(test)]
mod test;
