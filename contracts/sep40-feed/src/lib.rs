//! # Design
//!
//! A SEP-40 price feed with no state of its own: it quotes a vault's share
//! token against its deposit asset, reading the vault on every call rather
//! than keeping a configured pair.
//!
//! - **It follows the vault.** Every quote reads the vault's asset, share
//!   token, oracle and wind-down state. The cost: about nine reads per quote.
//! - **No price unless valid and quiet.** A price answers only while the
//!   oracle reports `Valid` and no wind-down is active. The cost: an oracle
//!   NAV pause holds the price away too; a vault pause or a proposed
//!   wind-down does not.
//! - **A failing read is no price.** A read that fails, the vault's or the
//!   oracle's, answers as if no price exists. The cost: a broken oracle looks
//!   like a missing price.
//! - **Fourteen decimals at the edge, WAD inside.** Every price lands in
//!   `DECIMALS` (14); the vault's NAV stays in WAD (18) until then. The cost:
//!   precision below 10^-14 is lost, and a price that floors to zero is no
//!   price.
//! - **Resolution is the freshness window.** `resolution` answers the
//!   oracle's `freshness_duration`, and a price's own timestamp is not
//!   rounded to it. The cost: the resolution moves with the oracle, against
//!   SEP-40's text.
//! - **The latest report only.** No history is kept, and no time past the
//!   ledger's own is answered. The cost: no history, and a time after the
//!   ledger is no price.
//! - **Upgrades only through the vault's timelock.** The feed carries no
//!   admin of its own; an upgrade is signed by the vault's current
//!   governance. The cost: a fix waits a full delay, with no hand-over of its
//!   own.

#![no_std]

mod governance;
mod guards;
mod price;
mod quote;

use sep40::{Asset, PriceData, PriceFeed};
use soroban_sdk::{
    contract, contracterror, contractevent, contractimpl, panic_with_error, vec, Address, Env, Vec,
};
use strata_bindings::{VaultBinding, VaultViewClient};
use strata_timelock::{setup, Clock, Refusal, TimelockHost};

pub use governance::{FeedChange, FeedPendingChange};
pub use price::{DECIMALS, ONE};

strata_bindings::error_enum! {
    strata_bindings::FEED_ERRORS,

    /// Feed failures, coded 9000 to 9999. Codes are stable once assigned and
    /// are never reused; a removed variant leaves its number retired.
    #[contracterror]
    #[derive(Copy, Clone, Debug, Eq, PartialEq)]
    #[repr(u32)]
    pub enum FeedError {
        /// The constructor's `vault` does not answer `asset`, `share_token`,
        /// `oracle`, `wind_down`, `governance` or `timelock_clock`.
        NotAVault = 9001,
        /// No pending change has this id.
        ChangeNotFound = 9002,
        /// The change's delay, plus any time the vault spent paused since, has
        /// not run yet.
        ChangeNotReady = 9003,
        /// The vault is winding down, so no change may be proposed or applied.
        WindDownActive = 9004,
        /// The vault is paused, which holds every timelocked change.
        VaultPaused = 9005,
        /// The change's delay is shorter than the vault's notice now.
        DelayBelowNotice = 9006,
        /// An upgrade already waits. Cancel it before proposing another.
        UpgradeAlreadyPending = 9007,
        /// The vault names no governance, or cannot be read, so no change can
        /// be signed.
        NoGovernance = 9008,
    }
}

#[contractevent]
pub struct ChangeProposed {
    #[topic]
    pub id: u32,
    pub change: FeedChange,
    pub eta: u64,
}

#[contractevent]
pub struct ChangeCancelled {
    #[topic]
    pub id: u32,
}

#[contractevent]
pub struct ChangeApplied {
    #[topic]
    pub id: u32,
    pub change: FeedChange,
}

#[contract]
pub struct Sep40Feed;

/// The feed keeps no clock of its own: it reads the vault's.
impl TimelockHost for Sep40Feed {
    fn clock(e: &Env) -> Result<Clock, Refusal> {
        strata_timelock::clock::from_source(e)
    }
}

/// The vault this feed follows. Its absence here is unreachable: the
/// constructor binds it before any other call can land.
fn bound_vault(e: &Env) -> Address {
    setup::source(e).unwrap_or_else(|| panic_with_error!(e, FeedError::NotAVault))
}

#[contractimpl]
impl Sep40Feed {
    /// Creates the feed bound to `vault`, reading its views once so an
    /// address that cannot be followed is refused at deployment.
    ///
    /// # Arguments
    ///
    /// * `vault` - The vault this feed quotes. Must answer `asset`,
    ///   `share_token`, `oracle`, `wind_down`, `governance` and
    ///   `timelock_clock`.
    ///
    /// # Errors
    ///
    /// * `NotAVault` - `vault` fails any of those reads.
    ///
    /// # Authorization
    ///
    /// None: it runs once, at deployment.
    pub fn __constructor(e: &Env, vault: Address) {
        guards::answers_as_vault(e, &vault);
        setup::bind_source(e, &vault).unwrap_or_else(|r| governance::refuse(e, r));
        setup::finish::<Sep40Feed>(e).unwrap_or_else(|r| governance::refuse(e, r));
    }

    /// Queues a change behind the vault's timelock and returns its id.
    ///
    /// # Arguments
    ///
    /// * `change` - An upgrade.
    ///
    /// # Errors
    ///
    /// * `WindDownActive` - The vault is winding down.
    /// * `UpgradeAlreadyPending` - An upgrade already waits.
    /// * `NoGovernance` - The vault names no governance, or cannot be read.
    ///
    /// # Events
    ///
    /// * `ChangeProposed`, with its `eta` in seconds; time the vault spends
    ///   paused from now on moves it later.
    ///
    /// # Authorization
    ///
    /// The vault's current governance signs.
    pub fn propose_change(e: &Env, change: FeedChange) -> u32 {
        guards::signed_by_governance(e);
        strata_storage::bump_instance(e);
        governance::propose(e, change)
    }

    /// Drops a pending change.
    ///
    /// # Arguments
    ///
    /// * `id` - The id `propose_change` returned.
    ///
    /// # Errors
    ///
    /// * `ChangeNotFound` - No pending change has this id.
    /// * `NoGovernance` - The vault names no governance, or cannot be read.
    ///
    /// # Events
    ///
    /// * `ChangeCancelled`
    ///
    /// # Authorization
    ///
    /// The vault's current governance signs.
    pub fn cancel_change(e: &Env, id: u32) {
        guards::signed_by_governance(e);
        strata_storage::bump_instance(e);
        governance::cancel(e, id);
    }

    /// Lands a change whose delay has run.
    ///
    /// # Arguments
    ///
    /// * `id` - The id `propose_change` returned.
    ///
    /// # Errors
    ///
    /// * `ChangeNotFound` - No pending change has this id.
    /// * `WindDownActive` - The vault is winding down.
    /// * `VaultPaused` - The vault is paused.
    /// * `DelayBelowNotice` - The change's delay is shorter than the vault's
    ///   notice now.
    /// * `ChangeNotReady` - The delay, plus any time the vault spent paused
    ///   since, has not run.
    /// * `NoGovernance` - The vault names no governance, or cannot be read.
    /// * An `Upgrade` whose Wasm is not on the network fails the call.
    ///
    /// # Events
    ///
    /// * `ChangeApplied`
    ///
    /// # Authorization
    ///
    /// The vault's current governance signs.
    pub fn apply_change(e: &Env, id: u32) {
        guards::signed_by_governance(e);
        strata_storage::bump_instance(e);
        governance::apply(e, id);
    }

    /// Every change still waiting, with the time in seconds it may land on
    /// the vault's clock as it reads now.
    pub fn pending_changes(e: &Env) -> Vec<FeedPendingChange> {
        governance::pending(e)
    }
}

#[contractimpl(contracttrait)]
impl VaultBinding for Sep40Feed {
    /// The vault this feed follows, bound once at construction.
    fn vault(e: &Env) -> Option<Address> {
        setup::source(e)
    }

    /// Always `false`: setup closes inside the constructor, before the feed
    /// answers any other call.
    fn setup_open(e: &Env) -> bool {
        setup::is_open(e)
    }
}

#[contractimpl(contracttrait)]
impl PriceFeed for Sep40Feed {
    /// The vault's deposit asset: every price is quoted in it.
    fn base(e: &Env) -> Asset {
        Asset::Stellar(VaultViewClient::new(e, &bound_vault(e)).asset())
    }

    /// The vault's share token: the only asset this feed prices.
    fn assets(e: &Env) -> Vec<Asset> {
        vec![
            e,
            Asset::Stellar(VaultViewClient::new(e, &bound_vault(e)).share_token()),
        ]
    }

    /// Decimal places every price carries: always `DECIMALS` (14).
    fn decimals(_e: &Env) -> u32 {
        DECIMALS
    }

    /// Seconds a report stays current: the vault's current oracle's
    /// `freshness_duration`. `0` when the vault or the oracle cannot be
    /// read; `u32::MAX` when the window does not fit a `u32`.
    fn resolution(e: &Env) -> u32 {
        quote::resolution(e)
    }

    /// The price of `asset` at `timestamp`, in `DECIMALS`, if the standing
    /// report covered that second.
    ///
    /// # Arguments
    ///
    /// * `asset` - The share token or the vault's base asset.
    /// * `timestamp` - Ledger seconds to price at; later than the current
    ///   ledger time gives `None`.
    ///
    /// `None` when `asset` is neither, the vault is winding down, its oracle
    /// is not `Valid`, `timestamp` falls outside `[attested_at,
    /// attested_at + resolution)`, or any read fails.
    fn price(e: &Env, asset: Asset, timestamp: u64) -> Option<PriceData> {
        quote::at(e, &asset, timestamp)
    }

    /// Up to `records` most recent prices of `asset`, in `DECIMALS`, newest
    /// first. The feed keeps no history, so this is `lastprice` alone, or
    /// `None` when `records` is `0`.
    ///
    /// # Arguments
    ///
    /// * `asset` - The share token or the vault's base asset.
    /// * `records` - Prices requested; only `0` changes the answer.
    fn prices(e: &Env, asset: Asset, records: u32) -> Option<Vec<PriceData>> {
        if records == 0 {
            return None;
        }
        quote::latest(e, &asset).map(|data| vec![e, data])
    }

    /// The most recent price of `asset`, in `DECIMALS`, timestamped at the
    /// report's attestation time.
    ///
    /// # Arguments
    ///
    /// * `asset` - The share token or the vault's base asset.
    ///
    /// `None` when `asset` is neither, the vault is winding down, its oracle
    /// is not `Valid`, or any read fails. A vault pause or a proposed
    /// wind-down does not clear it.
    fn lastprice(e: &Env, asset: Asset) -> Option<PriceData> {
        quote::latest(e, &asset)
    }
}

/// Stands in for a later feed version in the upgrade test. Never deployed.
#[cfg(feature = "upgrade_probe")]
#[contractimpl]
impl Sep40Feed {
    pub fn probe(_e: &Env) -> bool {
        true
    }
}

#[cfg(test)]
mod test;
