//! [SEP-40](https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0040.md)
//! price feed interface, version 0.1.0: the types and trait a feed and its
//! consumers share, with no dependency on this kit.

#![no_std]

#[cfg(test)]
mod test;

use soroban_sdk::{contracttrait, contracttype, Address, Env, Symbol, Vec};

/// An asset a feed quotes.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum Asset {
    /// An asset issued on this network.
    Stellar(Address),
    /// An asset identified by symbol, not a Stellar contract.
    Other(Symbol),
}

/// A price and the ledger time it was recorded.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PriceData {
    /// The price, scaled by the feed's `decimals`.
    pub price: i128,
    /// Ledger timestamp the price was recorded.
    pub timestamp: u64,
}

/// A SEP-40 price feed.
#[contracttrait]
pub trait PriceFeed {
    /// The asset every price is quoted in.
    fn base(e: &Env) -> Asset;
    /// The assets this feed prices.
    fn assets(e: &Env) -> Vec<Asset>;
    /// Decimal places each price carries.
    fn decimals(e: &Env) -> u32;
    /// Seconds between price records.
    fn resolution(e: &Env) -> u32;
    /// The price of `asset` recorded at `timestamp`, if any.
    fn price(e: &Env, asset: Asset, timestamp: u64) -> Option<PriceData>;
    /// Up to `records` most recent prices of `asset`, newest first, if any.
    fn prices(e: &Env, asset: Asset, records: u32) -> Option<Vec<PriceData>>;
    /// The most recent price of `asset`, if any.
    fn lastprice(e: &Env, asset: Asset) -> Option<PriceData>;
}
