/// Converts the oracle's NAV per share into a SEP-40 price: the NAV itself
/// when the asset and the share have the same decimals, otherwise shifted by
/// the difference and floored.
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
        nav_per_share.checked_mul(scale)?
    } else {
        let scale = 10i128.checked_pow(asset_decimals - share_decimals)?;
        nav_per_share / scale
    };

    (price > 0).then_some(price)
}
