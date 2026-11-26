//! # Design
//!
//! A third-party contract that reads a SEP-40 feed and records what it finds.
//! It proves the standard alone is enough to consume a feed; it is not part
//! of the kit.
//!
//! - **Knows only SEP-40.** It depends on the `sep40` crate alone, never on a
//!   kit crate. The cost: it cannot tell a kit feed from any other SEP-40
//!   feed, nor use anything the kit adds beyond the standard.
//! - **Never panics on a missing price or a failing feed.** A feed that
//!   answers no price, whose call fails outright, or whose address is not a
//!   contract, all end in `NoPrice`. The cost: a malformed feed address and
//!   an honest "no price yet" look the same from here. A feed that uses up
//!   the whole transaction budget still fails the call; this contract cannot
//!   protect against that.
//! - **One event per call.** `record_price` always emits exactly one of
//!   `PriceRecorded` or `NoPrice`. The cost: a caller watching only one event
//!   kind must still handle the other.
//! - **No state.** Nothing is written to instance or persistent storage; the
//!   price lives only in the event. The cost: no history, no last-known
//!   price to read back from the contract itself.
//! - **The price's age is left to the caller.** The price and timestamp are
//!   recorded as the feed gives them, with no check of the price's age
//!   against the ledger time; the feed already answers no price once its
//!   report lapses, but a contract that acts on a price should check its age
//!   against its own tolerance. The cost: copied as is, it trusts whatever
//!   window the feed's oracle uses.
//! - **Anyone may call it.** `record_price` takes no authorization. The cost:
//!   anyone can spend the call's fee to record a price, including a stale or
//!   absent one.

#![no_std]

#[cfg(test)]
mod test;

use sep40::{Asset, PriceFeedClient};
use soroban_sdk::{contract, contractevent, contractimpl, Address, Env, Executable};

#[contractevent]
pub struct PriceRecorded {
    #[topic]
    pub feed: Address,
    #[topic]
    pub asset: Asset,
    pub price: i128,
    pub timestamp: u64,
    pub decimals: u32,
    pub resolution: u32,
}

#[contractevent]
pub struct NoPrice {
    #[topic]
    pub feed: Address,
    #[topic]
    pub asset: Asset,
}

#[contract]
pub struct Sep40Consumer;

#[contractimpl]
impl Sep40Consumer {
    /// Reads `feed`'s price for `asset` and records what it finds.
    ///
    /// # Arguments
    ///
    /// * `feed` - The SEP-40 feed to read.
    /// * `asset` - The asset to price, in the feed's own terms.
    ///
    /// # Events
    ///
    /// * `PriceRecorded` - `feed` answered `decimals`, `resolution` and a
    ///   price for `asset`.
    /// * `NoPrice` - Any of those reads failed, the feed named no price, or
    ///   `feed` is not a contract address.
    ///
    /// # Authorization
    ///
    /// None.
    pub fn record_price(e: &Env, feed: Address, asset: Asset) {
        if !matches!(feed.executable(), Some(Executable::Wasm(_))) {
            NoPrice { feed, asset }.publish(e);
            return;
        }

        let client = PriceFeedClient::new(e, &feed);
        let reading = (
            client.try_decimals(),
            client.try_resolution(),
            client.try_lastprice(&asset),
        );

        if let (Ok(Ok(decimals)), Ok(Ok(resolution)), Ok(Ok(Some(data)))) = reading {
            PriceRecorded {
                feed,
                asset,
                price: data.price,
                timestamp: data.timestamp,
                decimals,
                resolution,
            }
            .publish(e);
        } else {
            NoPrice { feed, asset }.publish(e);
        }
    }
}
