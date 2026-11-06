/// SEP-40 price decimals the feed answers.
pub const DECIMALS: u32 = 14;
/// One unit of the feed's price, at `DECIMALS`.
pub const ONE: i128 = 100_000_000_000_000;

/// The gap between the kit's WAD (18 decimals) and the feed's `DECIMALS`.
const WAD_TO_FEED_SHIFT: u32 = 4;

/// Converts a WAD-scaled NAV per share into a SEP-40 price, floored.
pub(crate) fn share_price(
    nav_per_share: i128,
    asset_decimals: u32,
    share_decimals: u32,
) -> Option<i128> {
    if nav_per_share <= 0 {
        return None;
    }

    let price = if share_decimals >= asset_decimals {
        let scale = 10i128.checked_pow(share_decimals.checked_sub(asset_decimals)?)?;
        let shift = 10i128.checked_pow(WAD_TO_FEED_SHIFT)?;
        nav_per_share.checked_mul(scale)?.checked_div(shift)?
    } else {
        let exponent = asset_decimals
            .checked_sub(share_decimals)?
            .checked_add(WAD_TO_FEED_SHIFT)?;
        let scale = 10i128.checked_pow(exponent)?;
        nav_per_share.checked_div(scale)?
    };

    (price > 0).then_some(price)
}
