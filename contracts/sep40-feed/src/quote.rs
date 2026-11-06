use sep40::{Asset, PriceData};
use soroban_sdk::Env;

/// The most recent price of `asset`, if any.
pub(crate) fn latest(_e: &Env, _asset: &Asset) -> Option<PriceData> {
    None
}

/// The price of `asset` recorded at `timestamp`, if any.
pub(crate) fn at(_e: &Env, _asset: &Asset, _timestamp: u64) -> Option<PriceData> {
    None
}

/// Seconds between price records.
pub(crate) fn resolution(_e: &Env) -> u32 {
    0
}
