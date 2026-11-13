use soroban_sdk::testutils::storage::{Instance as _, Persistent as _};
use soroban_sdk::testutils::{Address as _, Ledger as _};
use soroban_sdk::{vec, Address, Symbol};
use strata_bindings::{OracleState, WindDownInfo, WindDownStatus};
use strata_timelock::DAY_DURATION;

use sep40::{Asset, PriceData};

use super::stubs::TokenStubClient;
use super::{setup, setup_with_decimals, PRICE};

fn at(price: i128, timestamp: u64) -> PriceData {
    PriceData { price, timestamp }
}

#[test]
fn the_share_is_quoted_at_its_nav_in_fourteen_decimals() {
    let f = setup();
    assert_eq!(f.feed.lastprice(&f.share_asset()), Some(at(PRICE, 10_000)));
}

#[test]
fn the_timestamp_is_the_attestation_time_not_rounded() {
    let f = setup();
    f.e.ledger().with_mut(|l| l.timestamp = 10_010);
    f.report(|r| {
        r.attested_at = 10_007;
        r.freshness_duration = 3_600;
    });
    assert_eq!(f.feed.lastprice(&f.share_asset()), Some(at(PRICE, 10_007)));
    assert_eq!(f.feed.resolution(), 3_600);
}

#[test]
fn the_base_asset_is_quoted_at_one() {
    let f = setup();
    assert_eq!(
        f.feed.lastprice(&f.base_asset()),
        Some(at(100_000_000_000_000, 10_000))
    );
}

#[test]
fn unequal_decimals_scale_the_price() {
    let f = setup_with_decimals(7, 9);
    f.report(|r| r.nav_per_share = 20_000_000_000_000_000);
    assert_eq!(
        f.feed.lastprice(&f.share_asset()),
        Some(at(200_000_000_000_000, 10_000))
    );

    let f = setup_with_decimals(7, 6);
    f.report(|r| r.nav_per_share = 20_000_000_000_000_000_000);
    assert_eq!(
        f.feed.lastprice(&f.share_asset()),
        Some(at(200_000_000_000_000, 10_000))
    );
}

#[test]
fn a_conversion_that_overflows_gives_no_price() {
    let f = setup_with_decimals(0, 38);
    assert_eq!(f.feed.lastprice(&f.share_asset()), None);
}

#[test]
fn a_nav_of_zero_or_less_gives_no_price() {
    let f = setup();
    f.report(|r| r.nav_per_share = 0);
    assert_eq!(f.feed.lastprice(&f.share_asset()), None);

    let f = setup();
    f.report(|r| r.nav_per_share = -1);
    assert_eq!(f.feed.lastprice(&f.share_asset()), None);
}

#[test]
fn a_stale_or_paused_oracle_gives_no_price() {
    for state in [OracleState::Stale, OracleState::Paused] {
        let f = setup();
        f.report(|r| r.state = state);

        assert_eq!(f.feed.lastprice(&f.share_asset()), None);
        assert_eq!(f.feed.lastprice(&f.base_asset()), None);
        assert_eq!(f.feed.price(&f.share_asset(), &10_000), None);
        assert_eq!(f.feed.prices(&f.share_asset(), &1), None);
    }
}

#[test]
fn an_active_wind_down_gives_no_price() {
    let f = setup();
    f.vault.set_wind_down(&Some(WindDownInfo {
        status: WindDownStatus::Active,
        active_at: 10_000,
        round: 0,
    }));

    assert_eq!(f.feed.lastprice(&f.share_asset()), None);
    assert_eq!(f.feed.lastprice(&f.base_asset()), None);
    assert_eq!(f.feed.price(&f.share_asset(), &10_000), None);
    assert_eq!(f.feed.prices(&f.share_asset(), &1), None);
}

#[test]
fn a_proposed_wind_down_or_a_vault_pause_keeps_the_price() {
    let f = setup();
    f.vault.set_wind_down(&Some(WindDownInfo {
        status: WindDownStatus::Proposed,
        active_at: 10_000,
        round: 0,
    }));
    f.clock(|c| c.paused = true);

    assert_eq!(f.feed.lastprice(&f.share_asset()), Some(at(PRICE, 10_000)));
}

#[test]
fn an_unknown_asset_gives_no_price() {
    let f = setup();
    for asset in [
        Asset::Stellar(Address::generate(&f.e)),
        Asset::Other(Symbol::new(&f.e, "USD")),
    ] {
        assert_eq!(f.feed.lastprice(&asset), None);
        assert_eq!(f.feed.price(&asset, &10_000), None);
        assert_eq!(f.feed.prices(&asset, &1), None);
    }
}

#[test]
fn a_failing_read_gives_no_price() {
    let f = setup();
    f.vault.trap(&Symbol::new(&f.e, "share_token"));
    assert_eq!(f.feed.lastprice(&f.share_asset()), None);

    let f = setup();
    f.vault.trap(&Symbol::new(&f.e, "asset"));
    assert_eq!(f.feed.lastprice(&f.share_asset()), None);

    let f = setup();
    f.vault.trap(&Symbol::new(&f.e, "wind_down"));
    assert_eq!(f.feed.lastprice(&f.share_asset()), None);

    let f = setup();
    f.vault.trap(&Symbol::new(&f.e, "oracle"));
    assert_eq!(f.feed.lastprice(&f.share_asset()), None);

    let f = setup();
    f.oracle.trap(&Symbol::new(&f.e, "state"));
    assert_eq!(f.feed.lastprice(&f.share_asset()), None);

    let f = setup();
    f.oracle.trap(&Symbol::new(&f.e, "nav_per_share"));
    assert_eq!(f.feed.lastprice(&f.share_asset()), None);

    let f = setup();
    f.oracle.trap(&Symbol::new(&f.e, "attested_at"));
    assert_eq!(f.feed.lastprice(&f.share_asset()), None);

    let f = setup();
    TokenStubClient::new(&f.e, &f.asset).trap();
    assert_eq!(f.feed.lastprice(&f.share_asset()), None);

    let f = setup();
    TokenStubClient::new(&f.e, &f.share).trap();
    assert_eq!(f.feed.lastprice(&f.share_asset()), None);
}

#[test]
fn resolution_is_the_current_oracles_freshness_window() {
    let f = setup();
    assert_eq!(f.feed.resolution(), 3_600);

    f.report(|r| r.freshness_duration = 7_200);
    assert_eq!(f.feed.resolution(), 7_200);
}

#[test]
fn a_freshness_window_past_u32_reads_as_the_largest_resolution() {
    let f = setup();
    f.report(|r| r.freshness_duration = u64::MAX);
    assert_eq!(f.feed.resolution(), u32::MAX);
}

#[test]
fn resolution_is_zero_when_the_oracle_cannot_answer() {
    let f = setup();
    f.oracle.trap(&Symbol::new(&f.e, "freshness_duration"));
    assert_eq!(f.feed.resolution(), 0);

    let f = setup();
    f.vault.trap(&Symbol::new(&f.e, "oracle"));
    assert_eq!(f.feed.resolution(), 0);
}

#[test]
fn price_needs_the_window_but_lastprice_does_not() {
    let f = setup();
    f.oracle.trap(&Symbol::new(&f.e, "freshness_duration"));

    assert_eq!(f.feed.lastprice(&f.share_asset()), Some(at(PRICE, 10_000)));
    assert_eq!(f.feed.price(&f.share_asset(), &10_000), None);
}

#[test]
fn a_window_that_overflows_the_ledger_clock_gives_no_price() {
    let f = setup();
    f.report(|r| r.freshness_duration = u64::MAX);

    assert_eq!(f.feed.price(&f.share_asset(), &10_000), None);
}

#[test]
fn the_feed_follows_an_oracle_swap() {
    let f = setup();
    let second = super::OracleStubClient::new(&f.e, &f.e.register(super::OracleStub, ()));
    second.set_report(&super::StubReport {
        state: OracleState::Valid,
        nav_per_share: 2_000_000_000_000_000_000,
        attested_at: 10_000,
        freshness_duration: 600,
    });
    f.vault.set_oracle(&second.address);

    assert_eq!(
        f.feed.lastprice(&f.share_asset()).unwrap().price,
        200_000_000_000_000
    );
    assert_eq!(f.feed.resolution(), 600);
    assert_eq!(
        strata_bindings::VaultBindingClient::new(&f.e, &f.feed.address).vault(),
        Some(f.vault.address.clone())
    );
}

#[test]
fn the_feed_stores_no_price() {
    let f = setup();
    let instance_before =
        f.e.as_contract(&f.feed.address, || f.e.storage().instance().all());
    let persistent_before =
        f.e.as_contract(&f.feed.address, || f.e.storage().persistent().all());

    f.feed.lastprice(&f.share_asset());

    let instance_after =
        f.e.as_contract(&f.feed.address, || f.e.storage().instance().all());
    let persistent_after =
        f.e.as_contract(&f.feed.address, || f.e.storage().persistent().all());
    assert_eq!(instance_before, instance_after);
    assert_eq!(persistent_before, persistent_after);

    f.report(|r| r.nav_per_share = 2_000_000_000_000_000_000);
    assert_eq!(
        f.feed.lastprice(&f.share_asset()).unwrap().price,
        200_000_000_000_000
    );
}

#[test]
fn price_answers_inside_the_reports_window_only() {
    let f = setup();
    f.advance(3_599);

    assert_eq!(f.feed.price(&f.share_asset(), &9_999), None);
    assert_eq!(
        f.feed.price(&f.share_asset(), &10_000),
        Some(at(PRICE, 10_000))
    );
    assert_eq!(
        f.feed.price(&f.share_asset(), &13_599),
        Some(at(PRICE, 10_000))
    );
    assert_eq!(
        f.feed.price(&f.base_asset(), &10_000),
        Some(at(100_000_000_000_000, 10_000))
    );
}

#[test]
fn the_last_second_of_a_report_is_quoted_by_lastprice_only() {
    let f = setup();
    f.advance(3_600);

    assert_eq!(f.feed.lastprice(&f.share_asset()), Some(at(PRICE, 10_000)));
    assert_eq!(f.feed.price(&f.share_asset(), &13_600), None);
}

#[test]
fn price_needs_a_valid_oracle_inside_the_window() {
    let f = setup();
    f.advance(1_000);
    f.report(|r| r.state = OracleState::Stale);

    assert_eq!(f.feed.price(&f.share_asset(), &11_000), None);
}

#[test]
fn a_time_after_the_ledger_gives_no_price() {
    let f = setup();
    f.advance(1_000);

    assert_eq!(
        f.feed.price(&f.share_asset(), &11_000),
        Some(at(PRICE, 10_000))
    );
    assert_eq!(f.feed.price(&f.share_asset(), &11_001), None);
    assert_eq!(f.feed.price(&f.base_asset(), &11_001), None);
}

#[test]
fn prices_returns_the_latest_report_only() {
    let f = setup();
    assert_eq!(
        f.feed.prices(&f.share_asset(), &1),
        Some(vec![&f.e, at(PRICE, 10_000)])
    );
    assert_eq!(
        f.feed.prices(&f.share_asset(), &10),
        Some(vec![&f.e, at(PRICE, 10_000)])
    );
    assert_eq!(f.feed.prices(&f.share_asset(), &0), None);
}

#[test]
fn when_the_asset_is_the_share_token_the_share_quote_wins() {
    let f = setup();
    f.vault.set_views(&f.share, &f.share, &f.oracle.address);

    assert_eq!(f.feed.lastprice(&f.share_asset()).unwrap().price, PRICE);
}

#[test]
fn a_price_read_restores_the_instance_ttl() {
    let f = setup();
    f.advance(2 * DAY_DURATION);
    let ttl_before =
        f.e.as_contract(&f.feed.address, || f.e.storage().instance().get_ttl());
    assert!(ttl_before < strata_storage::INSTANCE_EXTEND_AMOUNT);

    f.feed.lastprice(&f.share_asset());

    let ttl_after =
        f.e.as_contract(&f.feed.address, || f.e.storage().instance().get_ttl());
    assert_eq!(ttl_after, strata_storage::INSTANCE_EXTEND_AMOUNT);
}
