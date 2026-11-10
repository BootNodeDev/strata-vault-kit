mod constructor;
mod kit;
mod price;
mod quotes;
mod stubs;

use soroban_sdk::{
    testutils::{Address as _, Ledger as _},
    Address, Env,
};
use strata_bindings::{OracleFeedClient, OracleState};
use strata_timelock::{Clock, MIN_DELAY};

use sep40::Asset;

pub(crate) use stubs::{
    OracleStub, OracleStubClient, StubReport, TokenStub, VaultStub, VaultStubClient,
};

use crate::{FeedError, Sep40Feed, Sep40FeedClient};

/// The vault's standing report, as `nav_per_share = 1.05` WAD, prices at the
/// feed's 14 decimals.
#[allow(dead_code)]
pub(crate) const PRICE: i128 = 105_000_000_000_000;

pub(crate) struct Fixture<'a> {
    pub e: Env,
    pub feed: Sep40FeedClient<'a>,
    pub vault: VaultStubClient<'a>,
    #[allow(dead_code)]
    pub oracle: OracleStubClient<'a>,
    pub asset: Address,
    pub share: Address,
    #[allow(dead_code)]
    pub governance: Address,
}

impl Fixture<'_> {
    #[allow(dead_code)]
    fn share_asset(&self) -> Asset {
        Asset::Stellar(self.share.clone())
    }

    #[allow(dead_code)]
    fn base_asset(&self) -> Asset {
        Asset::Stellar(self.asset.clone())
    }

    /// Reads the oracle's standing report, lets `f` change it, then writes it back.
    #[allow(dead_code)]
    fn report(&self, f: impl FnOnce(&mut StubReport)) {
        let view = OracleFeedClient::new(&self.e, &self.oracle.address);
        let mut report = StubReport {
            state: view.state(),
            nav_per_share: view.nav_per_share(),
            attested_at: view.attested_at(),
            freshness_duration: view.freshness_duration(),
        };
        f(&mut report);
        self.oracle.set_report(&report);
    }

    /// Reads the vault's standing clock, lets `f` change it, then writes it back.
    #[allow(dead_code)]
    fn clock(&self, f: impl FnOnce(&mut Clock)) {
        let mut clock =
            strata_timelock::ClockSourceClient::new(&self.e, &self.vault.address).timelock_clock();
        f(&mut clock);
        self.vault.set_clock(&clock);
    }

    /// Moves the ledger clock and its sequence together, as nav-oracle's fixture does.
    #[allow(dead_code)]
    fn advance(&self, secs: u64) {
        self.e.ledger().with_mut(|l| {
            l.timestamp += secs;
            l.sequence_number += (secs / 5).max(1) as u32;
        });
    }
}

/// Asserts a call was refused with exactly this error.
#[allow(dead_code)]
pub(crate) fn refused<T: core::fmt::Debug + PartialEq, E: core::fmt::Debug + PartialEq>(
    result: Result<Result<T, E>, Result<soroban_sdk::Error, soroban_sdk::InvokeError>>,
    expected: FeedError,
) {
    assert_eq!(result, Err(Ok(expected.into())));
}

/// Asserts a call failed for lack of a valid signature, or because the callee
/// answers no interface the host can invoke: either way, the host's own
/// refusal of the invocation, not one of the feed's named errors.
#[allow(dead_code)]
pub(crate) fn missing_auth<T: core::fmt::Debug + PartialEq, E: core::fmt::Debug + PartialEq>(
    result: Result<Result<T, E>, Result<soroban_sdk::Error, soroban_sdk::InvokeError>>,
) {
    use soroban_sdk::xdr::{ScErrorCode, ScErrorType};
    assert_eq!(
        result,
        Err(Ok(soroban_sdk::Error::from_type_and_code(
            ScErrorType::Context,
            ScErrorCode::InvalidAction
        )))
    );
}

fn build<'a>(
    asset_decimals: u32,
    share_decimals: u32,
    register: impl FnOnce(&Env, (Address,)) -> Address,
) -> Fixture<'a> {
    let e = Env::default();
    e.mock_all_auths();
    e.ledger().set_timestamp(10_000);

    let asset = e.register(TokenStub, (asset_decimals,));
    let share = e.register(TokenStub, (share_decimals,));
    let oracle = OracleStubClient::new(&e, &e.register(OracleStub, ()));
    oracle.set_report(&StubReport {
        state: OracleState::Valid,
        nav_per_share: 1_050_000_000_000_000_000,
        attested_at: 10_000,
        freshness_duration: 3_600,
    });

    let governance = Address::generate(&e);
    let vault = VaultStubClient::new(&e, &e.register(VaultStub, ()));
    vault.set_views(&asset, &share, &oracle.address);
    vault.set_governance(&Some(governance.clone()));
    vault.set_clock(&Clock {
        delay: MIN_DELAY,
        exit_window: 0,
        paused_secs: 0,
        paused: false,
        winding_down: false,
    });

    let feed = Sep40FeedClient::new(&e, &register(&e, (vault.address.clone(),)));

    Fixture {
        e,
        feed,
        vault,
        oracle,
        asset,
        share,
        governance,
    }
}

pub(crate) fn setup<'a>() -> Fixture<'a> {
    setup_with_decimals(7, 7)
}

pub(crate) fn setup_with_decimals<'a>(asset: u32, share: u32) -> Fixture<'a> {
    build(asset, share, |e, (vault,)| e.register(Sep40Feed, (vault,)))
}

pub(crate) fn setup_with<'a>(register: impl FnOnce(&Env, (Address,)) -> Address) -> Fixture<'a> {
    build(7, 7, register)
}
