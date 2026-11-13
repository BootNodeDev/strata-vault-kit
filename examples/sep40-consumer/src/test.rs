extern crate std;

use soroban_sdk::{
    contract, contractimpl, symbol_short,
    testutils::{
        storage::Instance as _, storage::Persistent as _, storage::Temporary as _, Address as _,
        Events as _, Ledger as _,
    },
    Address, Env, Event as _,
};

use sep40::{Asset, PriceData, PriceFeed};

use crate::{NoPrice, PriceRecorded, Sep40Consumer, Sep40ConsumerClient};

#[contract]
struct FeedStub;

fn trapped(e: &Env) -> bool {
    e.storage()
        .instance()
        .get(&symbol_short!("trap"))
        .unwrap_or(false)
}

fn trap_if_set(e: &Env) {
    if trapped(e) {
        panic!("the stub traps");
    }
}

#[contractimpl]
impl FeedStub {
    pub fn quote(e: Env, asset: Asset, price: Option<PriceData>) {
        e.storage().instance().set(&symbol_short!("asset"), &asset);
        e.storage().instance().set(&symbol_short!("price"), &price);
    }

    pub fn trap(e: Env) {
        e.storage().instance().set(&symbol_short!("trap"), &true);
    }
}

#[contractimpl(contracttrait)]
impl PriceFeed for FeedStub {
    fn base(e: &Env) -> Asset {
        trap_if_set(e);
        Asset::Other(symbol_short!("USD"))
    }

    fn assets(e: &Env) -> soroban_sdk::Vec<Asset> {
        trap_if_set(e);
        soroban_sdk::Vec::new(e)
    }

    fn decimals(e: &Env) -> u32 {
        trap_if_set(e);
        14
    }

    fn resolution(e: &Env) -> u32 {
        trap_if_set(e);
        3_600
    }

    fn price(e: &Env, asset: Asset, _timestamp: u64) -> Option<PriceData> {
        Self::lastprice(e, asset)
    }

    fn prices(e: &Env, asset: Asset, records: u32) -> Option<soroban_sdk::Vec<PriceData>> {
        if records == 0 {
            return None;
        }
        Self::lastprice(e, asset).map(|data| soroban_sdk::vec![e, data])
    }

    fn lastprice(e: &Env, asset: Asset) -> Option<PriceData> {
        trap_if_set(e);
        let quoted: Option<Asset> = e.storage().instance().get(&symbol_short!("asset"));
        if quoted != Some(asset) {
            return None;
        }
        e.storage()
            .instance()
            .get(&symbol_short!("price"))
            .unwrap_or(None)
    }
}

struct Fixture {
    e: Env,
    consumer: Sep40ConsumerClient<'static>,
    feed: Address,
    share: Asset,
}

fn setup() -> Fixture {
    let e = Env::default();
    e.ledger().set_timestamp(10_000);

    let share = Asset::Stellar(Address::generate(&e));
    let feed = e.register(FeedStub, ());
    e.as_contract(&feed, || {
        FeedStub::quote(
            e.clone(),
            share.clone(),
            Some(PriceData {
                price: 105_000_000_000_000,
                timestamp: 10_000,
            }),
        );
    });

    let consumer = Sep40ConsumerClient::new(&e, &e.register(Sep40Consumer, ()));

    Fixture {
        e,
        consumer,
        feed,
        share,
    }
}

#[test]
fn a_quoted_asset_records_its_price() {
    let f = setup();

    f.consumer.record_price(&f.feed, &f.share);

    assert_eq!(
        f.e.events().all().filter_by_contract(&f.consumer.address),
        [PriceRecorded {
            feed: f.feed.clone(),
            asset: f.share.clone(),
            price: 105_000_000_000_000,
            timestamp: 10_000,
            decimals: 14,
            resolution: 3_600,
        }
        .to_xdr(&f.e, &f.consumer.address)]
    );
}

#[test]
fn a_missing_price_records_no_price() {
    let f = setup();
    f.e.as_contract(&f.feed, || {
        FeedStub::quote(f.e.clone(), f.share.clone(), None);
    });

    f.consumer.record_price(&f.feed, &f.share);

    assert_eq!(
        f.e.events().all().filter_by_contract(&f.consumer.address),
        [NoPrice {
            feed: f.feed.clone(),
            asset: f.share.clone(),
        }
        .to_xdr(&f.e, &f.consumer.address)]
    );
}

#[test]
fn an_unknown_asset_records_no_price() {
    let f = setup();
    let other = Asset::Other(symbol_short!("USD"));

    f.consumer.record_price(&f.feed, &other);

    assert_eq!(
        f.e.events().all().filter_by_contract(&f.consumer.address),
        [NoPrice {
            feed: f.feed.clone(),
            asset: other,
        }
        .to_xdr(&f.e, &f.consumer.address)]
    );
}

#[test]
fn a_feed_that_fails_records_no_price() {
    let f = setup();
    f.e.as_contract(&f.feed, || {
        FeedStub::trap(f.e.clone());
    });

    f.consumer.record_price(&f.feed, &f.share);

    assert_eq!(
        f.e.events().all().filter_by_contract(&f.consumer.address),
        [NoPrice {
            feed: f.feed.clone(),
            asset: f.share.clone(),
        }
        .to_xdr(&f.e, &f.consumer.address)]
    );
}

#[test]
fn the_consumer_keeps_no_state() {
    let f = setup();

    f.consumer.record_price(&f.feed, &f.share);

    let instance =
        f.e.as_contract(&f.consumer.address, || f.e.storage().instance().all());
    let persistent =
        f.e.as_contract(&f.consumer.address, || f.e.storage().persistent().all());
    let temporary =
        f.e.as_contract(&f.consumer.address, || f.e.storage().temporary().all());
    assert!(instance.is_empty());
    assert!(persistent.is_empty());
    assert!(temporary.is_empty());
}

#[test]
fn an_account_address_records_no_price() {
    let f = setup();
    let account =
        <soroban_sdk::MuxedAddress as soroban_sdk::testutils::MuxedAddress>::generate(&f.e)
            .address();

    f.consumer.record_price(&account, &f.share);

    assert_eq!(
        f.e.events().all().filter_by_contract(&f.consumer.address),
        [NoPrice {
            feed: account,
            asset: f.share.clone(),
        }
        .to_xdr(&f.e, &f.consumer.address)]
    );
}
