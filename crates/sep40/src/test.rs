extern crate std;

use soroban_sdk::{
    contract, contractimpl, symbol_short, testutils::Address as _, vec, xdr::ScVal, Address, Env,
    IntoVal, TryFromVal, Val,
};

use crate::{Asset, PriceData, PriceFeed, PriceFeedClient};

#[contract]
struct FixedFeed;

#[contractimpl(contracttrait)]
impl PriceFeed for FixedFeed {
    fn base(_e: &Env) -> Asset {
        Asset::Other(symbol_short!("USD"))
    }

    fn assets(e: &Env) -> soroban_sdk::Vec<Asset> {
        vec![e, Asset::Other(symbol_short!("XLM"))]
    }

    fn decimals(_e: &Env) -> u32 {
        14
    }

    fn resolution(_e: &Env) -> u32 {
        300
    }

    fn price(e: &Env, asset: Asset, timestamp: u64) -> Option<PriceData> {
        Self::lastprice(e, asset).filter(|_| timestamp == 1)
    }

    fn prices(e: &Env, asset: Asset, records: u32) -> Option<soroban_sdk::Vec<PriceData>> {
        if records == 0 {
            return None;
        }
        Self::lastprice(e, asset).map(|quote| vec![e, quote])
    }

    fn lastprice(_e: &Env, asset: Asset) -> Option<PriceData> {
        match asset {
            Asset::Other(symbol) if symbol == symbol_short!("XLM") => Some(PriceData {
                price: 7,
                timestamp: 1,
            }),
            _ => None,
        }
    }
}

#[test]
fn a_feed_answers_through_the_standard_client() {
    let e = Env::default();
    let feed = PriceFeedClient::new(&e, &e.register(FixedFeed, ()));
    let xlm = Asset::Other(symbol_short!("XLM"));
    let quote = PriceData {
        price: 7,
        timestamp: 1,
    };
    assert_eq!(feed.base(), Asset::Other(symbol_short!("USD")));
    assert_eq!(feed.assets(), vec![&e, xlm.clone()]);
    assert_eq!((feed.decimals(), feed.resolution()), (14, 300));
    assert_eq!(feed.lastprice(&xlm), Some(quote.clone()));
    assert_eq!(feed.price(&xlm, &1), Some(quote.clone()));
    assert_eq!(feed.prices(&xlm, &1), Some(vec![&e, quote]));
    assert_eq!(feed.lastprice(&Asset::Other(symbol_short!("BTC"))), None);
}

/// Decodes a value the way a feed's caller reads it off the wire.
fn decode<T: TryFromVal<Env, Val>>(e: &Env, scval: &ScVal) -> T {
    let val = Val::try_from_val(e, scval).unwrap();
    T::try_from_val(e, &val).unwrap_or_else(|_| panic!("value does not decode as expected"))
}

#[test]
fn assets_and_prices_encode_as_the_standard_types() {
    let e = Env::default();
    let holder = Address::generate(&e);
    let stellar = Asset::Stellar(holder.clone());
    let other = Asset::Other(symbol_short!("USD"));
    let quote = PriceData {
        price: 7,
        timestamp: 1,
    };

    let stellar_val: Val = stellar.into_val(&e);
    let ScVal::Vec(Some(stellar_entries)) = ScVal::try_from_val(&e, &stellar_val).unwrap() else {
        panic!("Asset::Stellar does not encode as a vector");
    };
    assert_eq!(stellar_entries.len(), 2);
    let tag: soroban_sdk::Symbol = decode(&e, &stellar_entries[0]);
    assert_eq!(tag, symbol_short!("Stellar"));
    let address: Address = decode(&e, &stellar_entries[1]);
    assert_eq!(address, holder);

    let other_val: Val = other.into_val(&e);
    let ScVal::Vec(Some(other_entries)) = ScVal::try_from_val(&e, &other_val).unwrap() else {
        panic!("Asset::Other does not encode as a vector");
    };
    assert_eq!(other_entries.len(), 2);
    let tag: soroban_sdk::Symbol = decode(&e, &other_entries[0]);
    assert_eq!(tag, symbol_short!("Other"));
    let symbol: soroban_sdk::Symbol = decode(&e, &other_entries[1]);
    assert_eq!(symbol, symbol_short!("USD"));

    let quote_val: Val = quote.into_val(&e);
    let ScVal::Map(Some(quote_entries)) = ScVal::try_from_val(&e, &quote_val).unwrap() else {
        panic!("PriceData does not encode as a map");
    };
    assert_eq!(quote_entries.len(), 2);
    let price_key: soroban_sdk::Symbol = decode(&e, &quote_entries[0].key);
    assert_eq!(price_key, symbol_short!("price"));
    let price: i128 = decode(&e, &quote_entries[0].val);
    assert_eq!(price, 7);
    let timestamp_key: soroban_sdk::Symbol = decode(&e, &quote_entries[1].key);
    assert_eq!(timestamp_key, symbol_short!("timestamp"));
    let timestamp: u64 = decode(&e, &quote_entries[1].val);
    assert_eq!(timestamp, 1);
}
