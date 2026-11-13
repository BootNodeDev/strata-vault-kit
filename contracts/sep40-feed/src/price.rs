/// The kit's NAV scale.
const WAD_DECIMALS: u32 = 18;
/// SEP-40 price decimals the feed answers.
pub const DECIMALS: u32 = 14;
/// One unit of the feed's price, at `DECIMALS`.
pub const ONE: i128 = 10i128.pow(DECIMALS);

/// The gap between the kit's WAD and the feed's `DECIMALS`.
const WAD_TO_FEED: i128 = 10i128.pow(WAD_DECIMALS - DECIMALS);

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
        let scale = 10i128.checked_pow(share_decimals - asset_decimals)?;
        nav_per_share.checked_mul(scale)? / WAD_TO_FEED
    } else {
        let scale = 10i128.checked_pow(asset_decimals - share_decimals)?;
        nav_per_share / WAD_TO_FEED / scale
    };

    (price > 0).then_some(price)
}
