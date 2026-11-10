extern crate std;

mod constructor;
mod kit;
mod price;
mod quotes;
mod stubs;
mod timelock;

use soroban_sdk::{
    testutils::{
        storage::Instance as _, Address as _, AuthorizedFunction, AuthorizedInvocation,
        Ledger as _, MockAuth, MockAuthInvoke,
    },
    Address, Env, Symbol, Val,
};
use strata_bindings::{OracleFeedClient, OracleState};
use strata_timelock::{Clock, MIN_DELAY};

use sep40::Asset;

pub(crate) use stubs::{
    OracleStub, OracleStubClient, StubReport, TokenStub, VaultStub, VaultStubClient,
};

use crate::{FeedError, Sep40Feed, Sep40FeedClient};

/// A margin past the instance's extend threshold, in ledgers.
const TWO_DAYS_IN_LEDGERS: u32 = 2 * 17_280;

/// The vault's standing report, as `nav_per_share = 1.05` WAD, prices at the
/// feed's 14 decimals.
pub(crate) const PRICE: i128 = 105_000_000_000_000;

pub(crate) struct Fixture<'a> {
    pub e: Env,
    pub feed: Sep40FeedClient<'a>,
    pub vault: VaultStubClient<'a>,
    pub oracle: OracleStubClient<'a>,
    pub asset: Address,
    pub share: Address,
    pub governance: Address,
}

impl Fixture<'_> {
    fn share_asset(&self) -> Asset {
        Asset::Stellar(self.share.clone())
    }

    fn base_asset(&self) -> Asset {
        Asset::Stellar(self.asset.clone())
    }

    /// Reads the oracle's standing report, lets `f` change it, then writes it back.
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
    fn clock(&self, f: impl FnOnce(&mut Clock)) {
        let mut clock =
            strata_timelock::ClockSourceClient::new(&self.e, &self.vault.address).timelock_clock();
        f(&mut clock);
        self.vault.set_clock(&clock);
    }

    /// Moves the ledger clock and its sequence together, as nav-oracle's fixture does.
    fn advance(&self, secs: u64) {
        self.e.ledger().with_mut(|l| {
            l.timestamp += secs;
            l.sequence_number += (secs / 5).max(1) as u32;
        });
    }

    fn instance_ttl(&self) -> u32 {
        self.e
            .as_contract(&self.feed.address, || self.e.storage().instance().get_ttl())
    }

    /// Lets the instance decay past its extend threshold, then checks the call
    /// extends it back to the full TTL.
    fn restores_the_instance(&self, call: impl FnOnce()) {
        self.e
            .ledger()
            .with_mut(|l| l.sequence_number += TWO_DAYS_IN_LEDGERS);
        assert!(self.instance_ttl() < strata_storage::INSTANCE_EXTEND_AMOUNT);
        call();
        assert_eq!(self.instance_ttl(), strata_storage::INSTANCE_EXTEND_AMOUNT);
    }

    /// Signs one call to the feed as `who` and nothing else, so the call
    /// carries that account's signature but not the vault's governance.
    fn sign_only_as(&self, who: &Address, fn_name: &str, args: soroban_sdk::Vec<Val>) {
        self.e.mock_auths(&[MockAuth {
            address: who,
            invoke: &MockAuthInvoke {
                contract: &self.feed.address,
                fn_name,
                args,
                sub_invokes: &[],
            },
        }]);
    }

    /// The last call asked `who` alone to sign, once, on exactly this call.
    fn signed_once_by(&self, who: &Address, fn_name: &str, args: soroban_sdk::Vec<Val>) {
        assert_eq!(
            self.e.auths(),
            std::vec![(
                who.clone(),
                AuthorizedInvocation {
                    function: AuthorizedFunction::Contract((
                        self.feed.address.clone(),
                        Symbol::new(&self.e, fn_name),
                        args,
                    )),
                    sub_invocations: std::vec![],
                },
            )]
        );
    }
}

/// Asserts a call was refused with exactly this error.
pub(crate) fn refused<T: core::fmt::Debug + PartialEq, E: core::fmt::Debug + PartialEq>(
    result: Result<Result<T, E>, Result<soroban_sdk::Error, soroban_sdk::InvokeError>>,
    expected: FeedError,
) {
    assert_eq!(result, Err(Ok(expected.into())));
}

/// Asserts a call failed for lack of a valid signature, or because the callee
/// answers no interface the host can invoke: either way, the host's own
/// refusal of the invocation, not one of the feed's named errors.
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
