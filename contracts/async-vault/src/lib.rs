//! # Design
//!
//! Deposits and redemptions are requests. Each joins the open epoch; the epoch
//! is sealed and priced at the oracle's report, and each holder claims the
//! result.
//!
//! - **The manager seals at any time, and anyone once the open epoch has run
//!   the minimum epoch duration governance sets; anyone prices.** The price is
//!   the oracle's, not the caller's. The cost: a silent attester stalls every
//!   request; a silent manager stalls them until the minimum runs, or, with no
//!   minimum set, until a replacement passes the timelock.
//! - **Pricing records totals; claims mint and burn.** Pricing costs the same
//!   for any number of requests. The cost: an epoch's rounding remainder stays
//!   in `committed` and `pending_mint_shares` until its last request settles.
//! - **A readable price closes cancellation,** during the notice too, until the
//!   feed goes stale or the NAV or the vault is paused. The cost: a report that
//!   lapses lets requests leave a sealed epoch late.
//! - **Priced before paid.** A redemption is priced whether or not the cash is
//!   there; its claim waits for the liquid reserve, and nothing goes to the
//!   custodian meanwhile. The cost: an exit can wait on treasury.
//! - **A refund below one share is not reserved.** Pricing sees only totals, so
//!   the refund comes from the free reserve at claim. The cost: treasury or a
//!   wind-down round can spend it first, and the claim waits.
//! - **Checked totals.** An asset or share total fails with `AmountTooLarge` on
//!   overflow, and with `AccountingMismatch` below zero unless signed, as
//!   `net_deployed` is. The cost: books that disagree fail the call.
//! - **A freeze holds every exit.** A frozen holder's requests, claims and
//!   cancellations fail with `Frozen` until it lifts: compliance can delay a
//!   payout, never redirect it. The cost: even a covered claim waits.
//! - **A delisted holder leaves in cash.** Shares priced for them join their
//!   redemption in the open epoch, or their wind-down entitlement. The cost:
//!   another epoch at its price, and a wait while the vault itself is delisted.
//! - **Setup, then the timelock.** Until `finish_setup` checks the wiring,
//!   admin changes are instant and requests and epochs refused; after it,
//!   changes that move value or cut a wait are timelocked. The cost: fixes
//!   take a week.
//! - **Wind-down claims run the compliance hooks:** surrendered shares burn
//!   through the `destroyed` modules. The cost: one failing in a wind-down
//!   blocks those claims, and no change can remove it then.

#![no_std]

mod deposit;
mod epoch;
mod error;
mod event;
mod extend;
mod governance;
mod guards;
mod health;
mod keys;
mod lock_policy;
mod pricing;
mod redeem;
mod roles;
mod settlement;
mod state;
mod timing;
mod treasury;
mod upgrade;
mod wind_down;

use soroban_sdk::{contract, contractimpl, panic_with_error, Address, Env, Symbol, Vec};
use stellar_access::access_control::{self, AccessControl};
use stellar_contract_utils::pausable::{self as pausable, Pausable};
use stellar_contract_utils::upgradeable;
use stellar_macros::{only_admin, only_role, when_not_paused};
use stellar_tokens::fungible::FungibleTokenClient;
use strata_timelock::{Clock, ClockSource, Refusal, TimelockHost, DAY_DURATION};

use keys::DataKey;
use roles::{GUARDIAN_ROLE, MANAGER_ROLE, TREASURY_ROLE};
use state::FIRST_EPOCH;

pub use error::VaultError;
pub use event::{
    ChangeApplied, ChangeCancelled, ChangeProposed, CustodianSet, Deployed, DepositCapUpdated,
    DepositClaimed, DepositConvertedToExit, DepositRequested, EpochClosed, EpochFulfilled,
    EpochReconciled, Funded, MinEpochDurationSet, NoticeSet, RedeemClaimed, RedeemRequested,
    RedemptionSurrendered, SetupFinished, WindDownActivated, WindDownClaimed, WindDownDelaySet,
    WindDownProposalCancelled, WindDownProposed, WindDownRoundFinalized,
};
pub use governance::{VaultChange, VaultPendingChange, ADMIN_ACCEPT_LEDGERS};
pub use health::Health;
pub use pricing::{DirectUnitPricing, PricingScheme};
pub use roles::VaultRoles;
pub use settlement::EpochSettlement;
pub use state::{DepositRequest, EpochInfo, EpochStatus, RedeemRequest};
pub use upgrade::{MAX_UPGRADE_DELAY, MIN_UPGRADE_DELAY};
pub use wind_down::{
    WindDownInfo, WindDownPosition, WindDownStatus, MAX_WIND_DOWN_DELAY, MIN_WIND_DOWN_DELAY,
};

/// Thirty days. Longer than any notice a real structure uses, short enough that
/// setting it by mistake is survivable.
pub const MAX_NOTICE_SECS: u64 = 30 * DAY_DURATION;

/// One day, so outsiders cannot seal a stream of tiny epochs.
pub const MIN_EPOCH_DURATION_FLOOR: u64 = DAY_DURATION;

/// Thirty days: monthly epochs fit, and a silent manager stalls no longer.
pub const MIN_EPOCH_DURATION_CEILING: u64 = 30 * DAY_DURATION;

#[cfg(feature = "short_wind_down")]
soroban_sdk::contractmeta!(key = "build", val = "short wind-down; local tests only");

fn role_holder(e: &Env, role: &Symbol) -> Option<Address> {
    if access_control::get_role_member_count(e, role) == 0 {
        return None;
    }
    Some(access_control::get_role_member(e, role, 0))
}

#[contract]
pub struct AsyncVault;

#[contractimpl]
impl AsyncVault {
    /// Creates the vault with its asset, share token, oracle and authorities,
    /// and opens epoch 1.
    ///
    /// # Arguments
    ///
    /// * `asset` - The deposit asset's token contract.
    /// * `share_token` - The share token.
    /// * `oracle` - The feed epochs are priced from.
    /// * `roles` - `governance` becomes the admin; `manager`, `treasury` and
    ///   `guardian` get their roles. `compliance` is read only by the
    ///   distinctness check; `attester` is not read.
    ///
    /// # Errors
    ///
    /// * `RolesNotDistinct` - `treasury` equals `guardian` or `governance`, or
    ///   `compliance` equals `governance` or `treasury`.
    ///
    /// # Events
    ///
    /// * `RoleGranted` for `manager`, `treasury` and `guardian`.
    ///
    /// # Authorization
    ///
    /// None: it runs once, at deployment.
    pub fn __constructor(
        e: &Env,
        asset: Address,
        share_token: Address,
        oracle: Address,
        roles: VaultRoles,
    ) {
        guards::roles_distinct(e, &roles);

        access_control::set_admin(e, &roles.governance);
        access_control::grant_role_no_auth(e, &roles.manager, &MANAGER_ROLE, &roles.governance);
        extend::role_entries(e, &roles.manager, &MANAGER_ROLE);
        access_control::grant_role_no_auth(e, &roles.treasury, &TREASURY_ROLE, &roles.governance);
        extend::role_entries(e, &roles.treasury, &TREASURY_ROLE);
        access_control::grant_role_no_auth(e, &roles.guardian, &GUARDIAN_ROLE, &roles.governance);
        extend::role_entries(e, &roles.guardian, &GUARDIAN_ROLE);

        state::set_addr(e, &DataKey::Asset, &asset);
        state::set_addr(e, &DataKey::ShareToken, &share_token);
        state::set_addr(e, &DataKey::Oracle, &oracle);

        state::set_epoch(e, FIRST_EPOCH, &epoch::open(0));
        state::set_current_epoch(e, FIRST_EPOCH);
        upgradeable::set_schema_version(e, 1);
    }

    /// The deposit asset's token contract.
    pub fn asset(e: &Env) -> Address {
        state::get_addr(e, &DataKey::Asset)
    }

    /// The share token.
    pub fn share_token(e: &Env) -> Address {
        state::get_addr(e, &DataKey::ShareToken)
    }

    /// The feed epochs are priced from.
    pub fn oracle(e: &Env) -> Address {
        state::get_addr(e, &DataKey::Oracle)
    }

    /// The admin: governance.
    pub fn governance(e: &Env) -> Option<Address> {
        access_control::get_admin(e)
    }

    /// The first holder of `manager`, which closes epochs.
    pub fn manager(e: &Env) -> Option<Address> {
        role_holder(e, &MANAGER_ROLE)
    }

    /// The first holder of `treasury`, which deploys capital to the
    /// custodian.
    pub fn treasury(e: &Env) -> Option<Address> {
        role_holder(e, &TREASURY_ROLE)
    }

    /// The first holder of `guardian`, which pauses the vault.
    pub fn guardian(e: &Env) -> Option<Address> {
        role_holder(e, &GUARDIAN_ROLE)
    }

    /// Where `deploy_to_custodian` sends capital, once set.
    pub fn custodian(e: &Env) -> Option<Address> {
        state::get_addr_opt(e, &DataKey::Custodian)
    }

    /// Asset base units sent to the custodian less those funded back;
    /// negative once more came back than went out.
    pub fn net_deployed(e: &Env) -> i128 {
        state::net_deployed(e)
    }

    /// Asset base units the vault holds that nothing is owed against: what is
    /// left after cancellable escrow, priced redemptions and credited
    /// wind-down rounds, and never below zero.
    pub fn free_reserve(e: &Env) -> i128 {
        treasury::free_reserve(e)
    }

    /// Asset base units owed to priced redemptions not yet claimed.
    pub fn committed(e: &Env) -> i128 {
        state::committed(e)
    }

    /// Asset base units owed to priced redemptions and cancellable escrow
    /// beyond what the vault holds. While it is positive, nothing can be
    /// deployed to the custodian.
    pub fn uncovered(e: &Env) -> i128 {
        treasury::uncovered(e)
    }

    /// Asset base units the vault holds, less the escrow depositors can still
    /// cancel. Can turn negative after the asset's issuer takes from the vault.
    pub fn liquid_reserve(e: &Env) -> i128 {
        treasury::liquid_reserve(e)
    }

    /// Asset base units escrowed by deposits in unpriced epochs.
    pub fn cancellable_escrow(e: &Env) -> i128 {
        state::cancellable_escrow(e)
    }

    /// Share base units priced for deposits and not yet claimed.
    pub fn pending_mint_shares(e: &Env) -> i128 {
        state::pending_mint_shares(e)
    }

    /// Share base units of priced redemptions not yet claimed.
    pub fn pending_burn_shares(e: &Env) -> i128 {
        state::pending_burn_shares(e)
    }

    /// Share base units outside the vault, plus those priced for deposits and
    /// not yet minted: the token's supply, less the vault's own balance, plus
    /// `pending_mint_shares`.
    pub fn total_economic_supply(e: &Env) -> i128 {
        let share_token = state::get_addr(e, &DataKey::ShareToken);
        let client = FungibleTokenClient::new(e, &share_token);
        let total_supply = client.total_supply();
        let vault_escrow = client.balance(&e.current_contract_address());
        let circulating = state::reduce(e, total_supply, vault_escrow);
        circulating
            .checked_add(state::pending_mint_shares(e))
            .unwrap_or_else(|| panic_with_error!(e, VaultError::AmountTooLarge))
    }

    /// The cap on deposited capital, in asset base units; `None` means no cap.
    pub fn deposit_cap(e: &Env) -> Option<i128> {
        state::deposit_cap(e)
    }

    /// Caps deposited capital: what the vault holds plus what it has deployed,
    /// less what priced redemptions are owed. A deposit request that would take
    /// it past the cap is refused. Instant, also after setup.
    ///
    /// # Arguments
    ///
    /// * `cap` - Asset base units, or `None` for no cap.
    ///
    /// # Errors
    ///
    /// * `InvalidAmount` - `cap` is negative.
    ///
    /// # Events
    ///
    /// * `DepositCapUpdated`
    ///
    /// # Authorization
    ///
    /// The admin signs.
    #[only_admin]
    pub fn set_deposit_cap(e: &Env, cap: Option<i128>) {
        guards::non_negative_cap(e, cap);
        let old_cap = state::deposit_cap(e);
        state::set_deposit_cap(e, cap);
        DepositCapUpdated {
            old_cap,
            new_cap: cap,
        }
        .publish(e);
    }

    /// Sets where deployed capital goes. Instant during setup; afterwards the
    /// custodian changes through the timelock. Never the vault itself.
    ///
    /// # Arguments
    ///
    /// * `custodian` - The account that receives deployed capital.
    ///
    /// # Errors
    ///
    /// * `InvalidCustodian` - `custodian` is the vault.
    /// * `UseTimelock` - Setup has finished.
    ///
    /// # Events
    ///
    /// * `CustodianSet`
    ///
    /// # Authorization
    ///
    /// The admin signs.
    #[only_admin]
    pub fn set_custodian(e: &Env, custodian: Address) {
        guards::custodian_not_the_vault(e, &custodian);
        guards::direct_change_allowed(e);
        treasury::set_custodian(e, &custodian);
    }

    /// Sets how long a wind-down proposal waits before it can start. Raising
    /// is instant. Lowering shortens the warning holders get before a
    /// wind-down starts, so after setup it waits for the timelock.
    ///
    /// # Arguments
    ///
    /// * `secs` - Seconds, from 7 to 90 days.
    ///
    /// # Errors
    ///
    /// * `WindDownDelayTooShort` - `secs` is under 7 days.
    /// * `WindDownDelayTooLong` - `secs` is over 90 days.
    /// * `UseTimelock` - Lowering after setup.
    ///
    /// # Events
    ///
    /// * `WindDownDelaySet`
    ///
    /// # Authorization
    ///
    /// The admin signs.
    #[only_admin]
    pub fn set_wind_down_delay(e: &Env, secs: u64) {
        guards::wind_down_delay_in_bounds(e, secs);
        guards::not_lowered_after_setup(e, secs, wind_down::delay(e));
        wind_down::set_delay(e, secs);
    }

    /// Seconds a wind-down proposal waits before it can start.
    pub fn wind_down_delay(e: &Env) -> u64 {
        wind_down::delay(e)
    }

    /// Sets how long the open epoch must stay open before anyone may seal it.
    /// Instant during setup; afterwards it changes through the timelock.
    ///
    /// # Arguments
    ///
    /// * `secs` - Seconds, from 1 to 30 days.
    ///
    /// # Errors
    ///
    /// * `InvalidAmount` - `secs` is under 1 day or over 30 days.
    /// * `UseTimelock` - Setup has finished.
    ///
    /// # Events
    ///
    /// * `MinEpochDurationSet`
    ///
    /// # Authorization
    ///
    /// The admin signs.
    #[only_admin]
    pub fn set_min_epoch_duration(e: &Env, secs: u64) {
        guards::min_epoch_duration_in_bounds(e, secs);
        guards::direct_change_allowed(e);
        governance::set_min_epoch_duration(e, secs);
    }

    /// Seconds the open epoch must stay open before anyone but the manager may
    /// seal it. `None` until governance sets one; while `None`, only the
    /// manager seals.
    pub fn min_epoch_duration(e: &Env) -> Option<u64> {
        state::min_epoch_duration(e)
    }

    /// The wind-down once proposed: whether it is proposed or active, the time
    /// in seconds it may start, and the rounds finalised.
    pub fn wind_down(e: &Env) -> Option<WindDownInfo> {
        wind_down::info(e)
    }

    /// Announces a wind-down, which anyone can start once the delay has run.
    /// New deposits stop at once; exits go on.
    ///
    /// # Errors
    ///
    /// * `WindDownActive` - The vault is already winding down.
    /// * `WindDownAlreadyProposed` - A proposal already stands.
    ///
    /// # Events
    ///
    /// * `WindDownProposed`, with `active_at` in seconds.
    ///
    /// # Authorization
    ///
    /// The admin signs.
    #[only_admin]
    pub fn propose_wind_down(e: &Env) {
        wind_down::propose(e);
    }

    /// Withdraws the standing wind-down proposal.
    ///
    /// # Errors
    ///
    /// * `WindDownActive` - The wind-down has started.
    /// * `WindDownNotProposed` - No proposal stands.
    ///
    /// # Events
    ///
    /// * `WindDownProposalCancelled`
    ///
    /// # Authorization
    ///
    /// The admin signs.
    #[only_admin]
    pub fn cancel_wind_down_proposal(e: &Env) {
        wind_down::cancel_proposal(e);
    }

    /// Starts the wind-down: from here on the vault takes no request and
    /// prices nothing, and holders exit through wind-down rounds. Open to
    /// anyone once the delay has passed, so the operator cannot stall the
    /// wind-down it announced.
    ///
    /// # Errors
    ///
    /// * `WindDownActive` - The wind-down has already started.
    /// * `WindDownNotProposed` - No proposal stands.
    /// * `WindDownDelayNotElapsed` - The delay has not run.
    ///
    /// # Events
    ///
    /// * `WindDownActivated`
    ///
    /// # Authorization
    ///
    /// None: anyone may call.
    pub fn activate_wind_down(e: &Env) {
        wind_down::activate(e);
    }

    /// Distributes the free reserve in proportion to the supply snapshot the
    /// first round takes, and returns the asset base units the round credits.
    /// Open to anyone once the wind-down is active.
    ///
    /// # Errors
    ///
    /// * `WindDownNotActive` - The wind-down has not started.
    /// * `NothingToDistribute` - No supply to divide by, or the free reserve
    ///   is empty.
    /// * `AmountTooLarge` - A figure of the round would overflow.
    ///
    /// # Events
    ///
    /// * `WindDownRoundFinalized`
    ///
    /// # Authorization
    ///
    /// None: anyone may call.
    pub fn finalize_wind_down_round(e: &Env) -> i128 {
        wind_down::finalize_round(e)
    }

    /// Asset base units the rounds credited that holders have not claimed.
    pub fn wind_down_owed(e: &Env) -> i128 {
        wind_down::owed(e)
    }

    /// Share base units the first round's snapshot divides by; zero before it.
    pub fn wind_down_supply(e: &Env) -> i128 {
        wind_down::supply_snapshot(e)
    }

    /// Asset base units every round has credited so far. A holder has earned
    /// their entitlement's share of it over `wind_down_supply`.
    pub fn wind_down_distributed(e: &Env) -> i128 {
        wind_down::distributed(e)
    }

    /// Surrenders the free shares the holder holds and pays their share of
    /// every round finalised since they last claimed. Returns the asset base
    /// units paid. A frozen holder is refused; a partial freeze surrenders
    /// only the free shares.
    ///
    /// # Arguments
    ///
    /// * `holder` - The shareholder.
    ///
    /// # Errors
    ///
    /// * `DistributionNotStarted` - No round has been finalised.
    /// * `Frozen` - `holder` is frozen.
    /// * `AmountTooLarge` - A total would overflow.
    /// * `AccountingMismatch` - A payout would go below what was already paid.
    /// * `NoEntitlement` - Nothing to surrender and nothing owed.
    /// * The asset's own error when `holder` cannot receive it.
    ///
    /// # Events
    ///
    /// * `WindDownClaimed`, after the token's `Burn` when shares are
    ///   surrendered.
    ///
    /// # Authorization
    ///
    /// `holder` signs.
    pub fn claim_wind_down(e: &Env, holder: Address) -> i128 {
        wind_down::claim(e, &holder)
    }

    /// What `claim_wind_down` would pay `holder` now, in asset base units:
    /// zero before the first round and for a frozen holder; fails where the
    /// claim fails.
    ///
    /// # Arguments
    ///
    /// * `holder` - The shareholder.
    pub fn wind_down_claimable(e: &Env, holder: Address) -> i128 {
        wind_down::claimable(e, &holder)
    }

    /// Sets the notice: how long a closed epoch waits before it can be priced.
    /// Raising is instant. Lowering shortens the wait of every epoch closed
    /// afterwards, so after setup it waits for the timelock.
    ///
    /// # Arguments
    ///
    /// * `secs` - Seconds; at most 30 days and at most the upgrade delay.
    ///
    /// # Errors
    ///
    /// * `UseTimelock` - Lowering after setup.
    /// * `NoticeTooLong` - `secs` is over 30 days.
    /// * `NoticeAboveUpgradeDelay` - `secs` exceeds the upgrade delay.
    ///
    /// # Events
    ///
    /// * `NoticeSet`
    ///
    /// # Authorization
    ///
    /// The admin signs.
    #[only_admin]
    pub fn set_notice(e: &Env, secs: u64) {
        guards::not_lowered_after_setup(e, secs, state::notice(e));
        guards::notice_in_bounds(e, secs);
        governance::set_notice(e, secs);
    }

    /// Ends the window in which admin changes are instant. Needs every wiring
    /// check `health()` reports, no shares outstanding, the vault's own books
    /// empty and no admin hand-over pending. Deposits open from here on, and
    /// it never reopens.
    ///
    /// # Errors
    ///
    /// * `SetupClosed` - Setup has already finished.
    /// * `AdminTransferPending` - An admin hand-over offered during setup is
    ///   still open.
    /// * `SetupIncomplete` - A wiring check fails, shares are outstanding, or
    ///   the vault's own books are not empty.
    ///
    /// # Events
    ///
    /// * `SetupFinished`
    ///
    /// # Authorization
    ///
    /// The admin signs.
    #[only_admin]
    pub fn finish_setup(e: &Env) {
        governance::finish_setup(e);
    }

    /// Whether setup is still open: admin changes are instant, and the vault
    /// takes no request and seals or prices no epoch.
    pub fn setup_open(e: &Env) -> bool {
        strata_timelock::setup::is_open(e)
    }

    /// Whether setup is open, the wiring `finish_setup` checks except the share
    /// supply and the vault's own books, and the feed: whether it can price
    /// now, and whether its reports outlive the notice.
    pub fn health(e: &Env) -> Health {
        health::health(e)
    }

    /// Queues a change behind the timelock and returns its id. It waits the
    /// upgrade delay, plus any time the vault spends paused.
    ///
    /// # Arguments
    ///
    /// * `change` - An upgrade, a new upgrade delay, custodian, notice,
    ///   wind-down delay, oracle or minimum epoch duration, a role grant or
    ///   revoke, or an admin hand-over. Durations in seconds.
    ///
    /// # Errors
    ///
    /// * `WindDownActive` - The vault is winding down.
    /// * `SetupOpen` - Setup has not finished; change it directly.
    /// * `UpgradeDelayTooShort`, `UpgradeDelayTooLong`,
    ///   `UpgradeDelayBelowNotice`, `NoticeTooLong`, `NoticeAboveUpgradeDelay`,
    ///   `WindDownDelayTooShort`, `WindDownDelayTooLong`, `FeedNotBound`,
    ///   `InvalidCustodian`, `InvalidAmount` - The change is out of bounds.
    /// * `UpgradeProposalExists` - An upgrade or an upgrade delay change, while
    ///   one of the two already waits.
    /// * `TooManyPendingChanges` - The queue is full.
    ///
    /// # Events
    ///
    /// * `ChangeProposed`, with its `eta` in seconds.
    ///
    /// # Authorization
    ///
    /// The admin signs.
    #[only_admin]
    pub fn propose_change(e: &Env, change: VaultChange) -> u32 {
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
    ///
    /// # Events
    ///
    /// * `ChangeCancelled`
    ///
    /// # Authorization
    ///
    /// The admin signs.
    #[only_admin]
    pub fn cancel_change(e: &Env, id: u32) {
        governance::cancel(e, id);
    }

    /// Lands a change whose delay has run, checking its bounds again.
    ///
    /// # Arguments
    ///
    /// * `id` - The id `propose_change` returned.
    ///
    /// # Errors
    ///
    /// * `ChangeNotFound` - No pending change has this id.
    /// * `WindDownActive` - The vault is winding down.
    /// * `PausableError::EnforcedPause` - The vault is paused.
    /// * `UpgradeDelayBelowNotice` - The change's delay is shorter than the
    ///   notice now.
    /// * `ChangeNotReady` - The delay, plus any time paused since, has not run.
    /// * The bound errors of `propose_change`, checked again.
    /// * `AccessControlError::RoleNotHeld` - A `RevokeRole` names an account
    ///   without the role.
    /// * An `Upgrade` whose Wasm is not on the network fails the call.
    ///
    /// # Events
    ///
    /// * `ChangeApplied`, after the change's own: `CustodianSet`, `NoticeSet`,
    ///   `WindDownDelaySet`, `MinEpochDurationSet`, `RoleGranted`,
    ///   `RoleRevoked` or `AdminTransferInitiated`.
    ///
    /// # Authorization
    ///
    /// The admin signs.
    #[only_admin]
    pub fn apply_change(e: &Env, id: u32) {
        governance::apply(e, id);
    }

    /// Every change still waiting, with the time in seconds it may land as
    /// the clock reads now.
    pub fn pending_changes(e: &Env) -> Vec<VaultPendingChange> {
        governance::pending(e)
    }

    /// Seconds a proposed change waits: 7 days until an `UpgradeDelay` change
    /// sets another.
    pub fn upgrade_delay(e: &Env) -> u64 {
        upgrade::delay(e)
    }

    /// The storage layout version, `1` until an upgrade migrates it.
    pub fn schema_version(e: &Env) -> u32 {
        upgradeable::get_schema_version(e)
    }

    /// Sends free reserve to the custodian and returns `net_deployed` after
    /// it. It never sends escrow a depositor can cancel or cash owed to
    /// priced exits. The pause does not stop it.
    ///
    /// # Arguments
    ///
    /// * `caller` - A `treasury` holder.
    /// * `assets` - Asset base units.
    ///
    /// # Errors
    ///
    /// * `AccessControlError::Unauthorized` - `caller` lacks `treasury`.
    /// * `WindDownActive` - The vault is winding down.
    /// * `InvalidAmount` - `assets` is zero or negative.
    /// * `CustodianNotSet` - No custodian is set.
    /// * `ReserveCommittedToExits` - `assets` exceeds the free reserve.
    /// * The asset's own error when the custodian cannot receive it.
    ///
    /// # Events
    ///
    /// * `Deployed`
    ///
    /// # Authorization
    ///
    /// `caller` signs.
    #[only_role(caller, "treasury")]
    pub fn deploy_to_custodian(e: &Env, caller: Address, assets: i128) -> i128 {
        treasury::deploy(e, assets)
    }

    /// Pays assets into the vault, lowering `net_deployed` by them, and
    /// returns `net_deployed` after it. The custodian's capital comes back
    /// this way. Anyone may fund, during a pause or a wind-down too.
    ///
    /// # Arguments
    ///
    /// * `caller` - The account paying.
    /// * `assets` - Asset base units.
    ///
    /// # Errors
    ///
    /// * `InvalidAmount` - `assets` is zero or negative.
    /// * `AmountTooLarge` - `net_deployed` would fall below `i128::MIN`.
    /// * The asset's own error when `caller` cannot pay.
    ///
    /// # Events
    ///
    /// * `Funded`
    ///
    /// # Authorization
    ///
    /// `caller` signs.
    pub fn fund(e: &Env, caller: Address, assets: i128) -> i128 {
        treasury::fund(e, &caller, assets)
    }

    /// Seconds a closed epoch waits before it can be priced.
    pub fn notice(e: &Env) -> u64 {
        state::notice(e)
    }

    /// The id of the open epoch, which takes new requests.
    pub fn current_epoch(e: &Env) -> u64 {
        state::current_epoch(e)
    }

    /// Ledger time, in seconds, the open epoch started (when setup finished or
    /// the epoch before it was sealed). `None` before setup finishes.
    pub fn epoch_opened_at(e: &Env) -> Option<u64> {
        state::epoch_opened_at(e)
    }

    /// An epoch: its status, deposits in asset base units, redemptions in share
    /// base units, price in WAD, and close and pricing times in seconds.
    ///
    /// # Arguments
    ///
    /// * `epoch_id` - The epoch.
    pub fn get_epoch(e: &Env, epoch_id: u64) -> Option<EpochInfo> {
        state::get_epoch(e, epoch_id)
    }

    /// What pricing promised the epoch and what has been paid against it:
    /// open request counts, shares in share base units, assets in asset base
    /// units.
    ///
    /// # Arguments
    ///
    /// * `epoch_id` - The epoch.
    pub fn get_epoch_settlement(e: &Env, epoch_id: u64) -> Option<EpochSettlement> {
        settlement::get(e, epoch_id)
    }

    /// A holder's deposit in an epoch: its amount in asset base units, and
    /// whether it was claimed.
    ///
    /// # Arguments
    ///
    /// * `epoch_id` - The epoch.
    /// * `holder` - The depositor.
    pub fn get_deposit_request(e: &Env, epoch_id: u64, holder: Address) -> Option<DepositRequest> {
        state::get_deposit_request(e, epoch_id, &holder)
    }

    /// Escrows `amount` of the asset into the open epoch and returns the
    /// epoch's id. The deposit can be priced once the epoch closes and its
    /// notice has run. Refused while the feed cannot price.
    ///
    /// # Arguments
    ///
    /// * `holder` - The depositor.
    /// * `amount` - Asset base units.
    ///
    /// # Errors
    ///
    /// * `PausableError::EnforcedPause` - The vault is paused.
    /// * `WindDownActive`, `WindDownAlreadyProposed` - A wind-down is active
    ///   or proposed.
    /// * `SetupOpen` - Setup has not finished.
    /// * `InvalidAmount` - `amount` is zero or negative.
    /// * `NotAllowlisted` - `holder` fails the identity check.
    /// * `Frozen` - `holder` is frozen.
    /// * `FeedNotValid` - The feed is stale or the NAV is paused.
    /// * `EscrowNotCovered` - The vault holds less than its pending escrow.
    /// * `DepositCapExceeded` - The deposit would pass the cap.
    /// * `RequestOutstanding` - `holder` has a deposit in this epoch already.
    /// * `AmountTooLarge` - A total would overflow.
    /// * The asset's own error when `holder` cannot pay.
    ///
    /// # Events
    ///
    /// * `DepositRequested`
    ///
    /// # Authorization
    ///
    /// `holder` signs.
    #[when_not_paused]
    pub fn request_deposit(e: &Env, holder: Address, amount: i128) -> u64 {
        deposit::request(e, &holder, amount)
    }

    /// Mints a priced deposit's shares and returns them, in share base units.
    /// Zero means none: a deposit worth less than one share base unit was
    /// refunded, or a delisted holder's shares joined an exit.
    ///
    /// # Arguments
    ///
    /// * `holder` - The depositor.
    /// * `epoch_id` - The epoch the deposit joined.
    ///
    /// # Errors
    ///
    /// * `EpochNotFound` - No such epoch.
    /// * `EpochNotFulfilled` - The epoch is not priced yet.
    /// * `RequestNotFound` - `holder` has no deposit in the epoch.
    /// * `AlreadyClaimed` - The deposit was claimed.
    /// * `Frozen` - `holder` is frozen.
    /// * `ClaimNotCovered` - The free reserve cannot cover a refund yet.
    /// * `RWAError::MintNotCompliant` - The compliance rules refuse the mint.
    /// * `RWAError::IdentityVerificationFailed` - The vault is delisted, for a
    ///   conversion.
    /// * The asset's own error when `holder` cannot receive a refund.
    ///
    /// # Events
    ///
    /// * `DepositClaimed`, `DepositConvertedToExit` or, for a refund,
    ///   `DepositCancelled`.
    /// * `EpochReconciled` once the epoch's last request settles.
    ///
    /// # Authorization
    ///
    /// `holder` signs.
    pub fn claim_deposit(e: &Env, holder: Address, epoch_id: u64) -> i128 {
        deposit::claim(e, &holder, epoch_id)
    }

    /// Cancels an unpriced deposit and returns the asset base units refunded.
    /// Open while the epoch has no readable price: a paused vault or NAV, or
    /// an expired report, reopens it. Never blocked by the pause.
    ///
    /// # Arguments
    ///
    /// * `holder` - The depositor.
    /// * `epoch_id` - The epoch the deposit joined.
    ///
    /// # Errors
    ///
    /// * `EpochNotFound` - No such epoch.
    /// * `AlreadyPriced` - The epoch is priced; claim instead.
    /// * `PriceAvailable` - A report accepted after the close is valid, so the
    ///   price is known, even while the notice runs.
    /// * `RequestNotFound` - `holder` has no deposit in the epoch.
    /// * `Frozen` - `holder` is frozen.
    /// * `EscrowNotCovered` - The vault's balance cannot cover the refund yet.
    /// * The asset's own error when `holder` cannot receive it.
    ///
    /// # Events
    ///
    /// * `DepositCancelled`
    ///
    /// # Authorization
    ///
    /// `holder` signs.
    pub fn cancel_deposit(e: &Env, holder: Address, epoch_id: u64) -> i128 {
        deposit::cancel(e, &holder, epoch_id)
    }

    /// Cancels an unpriced redemption and returns its share base units. Outside
    /// a wind-down the shares come back, even while the token is paused, unless
    /// the holder is delisted, frozen or refused by the compliance rules; in one
    /// the escrow joins the holder's entitlement, and a frozen holder is held.
    ///
    /// # Arguments
    ///
    /// * `holder` - The redeemer.
    /// * `epoch_id` - The epoch the redemption joined.
    ///
    /// # Errors
    ///
    /// * `EpochNotFound` - No such epoch.
    /// * `AlreadyPriced` - The epoch is priced; claim instead.
    /// * `PriceAvailable` - A report accepted after the close is valid, so the
    ///   price is known, even while the notice runs.
    /// * `RequestNotFound` - `holder` has no redemption in the epoch.
    /// * `NotAllowlisted` - `holder` is delisted.
    /// * `Frozen` - `holder` is frozen.
    /// * `HolderNotEligible` - The compliance rules refuse the return.
    ///
    /// # Events
    ///
    /// * `RedeemCancelled`, or `RedemptionSurrendered` in a wind-down.
    ///
    /// # Authorization
    ///
    /// `holder` signs.
    pub fn cancel_redeem(e: &Env, holder: Address, epoch_id: u64) -> i128 {
        redeem::cancel(e, &holder, epoch_id)
    }

    /// Escrows `shares` into the open epoch's redemptions and returns the
    /// epoch's id. Open to a delisted holder, and while the vault or the token
    /// is paused.
    ///
    /// # Arguments
    ///
    /// * `holder` - The redeemer.
    /// * `shares` - Share base units.
    ///
    /// # Errors
    ///
    /// * `WindDownActive` - The vault is winding down.
    /// * `SetupOpen` - Setup has not finished.
    /// * `InvalidAmount` - `shares` is zero or negative.
    /// * `Frozen` - `holder` is frozen, or `shares` needs frozen shares.
    /// * `RequestOutstanding` - `holder` has a redemption in this epoch
    ///   already.
    /// * `AmountTooLarge` - A total would overflow.
    /// * `RWAError::InsufficientBalance` - `shares` exceeds the balance.
    ///
    /// # Events
    ///
    /// * `RedeemRequested`, after the token's `Transfer`.
    ///
    /// # Authorization
    ///
    /// `holder` signs.
    pub fn request_redeem(e: &Env, holder: Address, shares: i128) -> u64 {
        redeem::request(e, &holder, shares)
    }

    /// A holder's redemption in an epoch: its shares in share base units, and
    /// whether it was claimed.
    ///
    /// # Arguments
    ///
    /// * `epoch_id` - The epoch.
    /// * `holder` - The redeemer.
    pub fn get_redeem_request(e: &Env, epoch_id: u64, holder: Address) -> Option<RedeemRequest> {
        state::get_redeem_request(e, epoch_id, &holder)
    }

    /// Pays a priced redemption and returns the asset base units paid. Open
    /// while paused and to a delisted holder. Outside a wind-down, shares
    /// priced at nothing come back instead.
    ///
    /// # Arguments
    ///
    /// * `holder` - The redeemer.
    /// * `epoch_id` - The epoch the redemption joined.
    ///
    /// # Errors
    ///
    /// * `EpochNotFound` - No such epoch.
    /// * `EpochNotFulfilled` - The epoch is not priced yet.
    /// * `RequestNotFound` - `holder` has no redemption in the epoch.
    /// * `AlreadyClaimed` - The redemption was claimed.
    /// * `Frozen` - `holder` is frozen.
    /// * `ClaimNotCovered` - The liquid reserve cannot pay it yet.
    /// * `HolderNotEligible` - Shares priced at nothing cannot come back.
    /// * The asset's own error when `holder` cannot receive it.
    ///
    /// # Events
    ///
    /// * `RedeemClaimed`, or `RedeemCancelled` when the shares come back.
    /// * `EpochReconciled` once the epoch's last request settles.
    ///
    /// # Authorization
    ///
    /// `holder` signs.
    pub fn claim_redeem(e: &Env, holder: Address, epoch_id: u64) -> i128 {
        redeem::claim(e, &holder, epoch_id)
    }

    /// Seals the open epoch, opens the next, and returns the sealed epoch's
    /// id. The manager seals at any time, anyone else once the open epoch has
    /// been open for the minimum epoch duration. It can be priced once its
    /// notice has run.
    ///
    /// # Arguments
    ///
    /// * `caller` - A `manager` holder, or any account once the minimum has
    ///   run.
    ///
    /// # Errors
    ///
    /// * `AccessControlError::Unauthorized` - `caller` lacks `manager` and no
    ///   minimum epoch duration is set.
    /// * `MinEpochDurationNotElapsed` - `caller` lacks `manager` and the open
    ///   epoch has not run the minimum.
    /// * `WindDownActive` - The vault is winding down.
    /// * `SetupOpen` - Setup has not finished.
    ///
    /// # Events
    ///
    /// * `EpochClosed`
    ///
    /// # Authorization
    ///
    /// `caller` signs.
    pub fn close_epoch(e: &Env, caller: Address) -> u64 {
        guards::allowed_to_seal(e, &caller);
        caller.require_auth();
        epoch::close(e)
    }

    /// Prices a sealed epoch at the feed's standing report and returns the
    /// share price in WAD: asset base units per share base unit. Open to
    /// anyone once the notice has run and a report accepted after the close
    /// is valid.
    ///
    /// # Arguments
    ///
    /// * `epoch_id` - A sealed epoch.
    ///
    /// # Errors
    ///
    /// * `PausableError::EnforcedPause` - The vault is paused.
    /// * `WindDownActive` - The vault is winding down.
    /// * `SetupOpen` - Setup has not finished.
    /// * `EpochNotFound` - No such epoch.
    /// * `EpochNotPending` - The epoch is open or already priced.
    /// * `NoticeNotElapsed` - The notice has not run.
    /// * `FeedNotValid` - The feed is paused or stale.
    /// * `AttestationBeforeClose` - The report predates the close.
    /// * `InvalidSharePrice` - The feed returned zero or less.
    /// * `AmountTooLarge` - A total or a conversion would overflow.
    ///
    /// # Events
    ///
    /// * `EpochFulfilled`
    /// * `EpochReconciled` when the epoch has no open request.
    ///
    /// # Authorization
    ///
    /// None: anyone may call.
    #[when_not_paused]
    pub fn fulfill_epoch(e: &Env, epoch_id: u64) -> i128 {
        epoch::fulfill(e, epoch_id)
    }
}

#[contractimpl(contracttrait)]
impl AccessControl for AsyncVault {
    /// Grants `role` to `account` at once. Only during setup; after it, propose
    /// a `GrantRole` change.
    ///
    /// # Arguments
    ///
    /// * `account` - The account that gets the role.
    /// * `role` - `manager`, `treasury` or `guardian`.
    /// * `caller` - The admin.
    ///
    /// # Errors
    ///
    /// * `UseTimelock` - Setup has finished.
    /// * `AccessControlError::Unauthorized` - `caller` is not the admin.
    ///
    /// # Events
    ///
    /// * `RoleGranted`, unless `account` already holds `role`.
    ///
    /// # Authorization
    ///
    /// `caller` signs.
    fn grant_role(e: &Env, account: Address, role: Symbol, caller: Address) {
        guards::direct_change_allowed(e);
        access_control::grant_role(e, &account, &role, &caller);
        extend::role_entries(e, &account, &role);
    }

    /// Takes `role` from `account`. Instant for every role but `manager`:
    /// taking `treasury` or `guardian` away moves no value. After setup,
    /// revoking `manager` waits like a grant, because without it no epoch
    /// closes and no exit is priced.
    ///
    /// # Arguments
    ///
    /// * `account` - The account that loses the role.
    /// * `role` - `manager`, `treasury` or `guardian`.
    /// * `caller` - The admin.
    ///
    /// # Errors
    ///
    /// * `UseTimelock` - `manager`, after setup.
    /// * `AccessControlError::Unauthorized` - `caller` is not the admin.
    /// * `AccessControlError::RoleNotHeld` - `account` does not hold `role`.
    ///
    /// # Events
    ///
    /// * `RoleRevoked`
    ///
    /// # Authorization
    ///
    /// `caller` signs.
    fn revoke_role(e: &Env, account: Address, role: Symbol, caller: Address) {
        guards::direct_revoke_allowed(e, &role);
        access_control::revoke_role(e, &account, &role, &caller);
    }

    /// Offers the admin role to `new_admin`, who takes it with
    /// `accept_admin_transfer`. An offer is instant only during setup; after
    /// it, propose an `Admin` change. Cancelling an offer stays instant.
    ///
    /// # Arguments
    ///
    /// * `new_admin` - The nominee, or the pending nominee when cancelling.
    /// * `live_until_ledger` - The last ledger number the nominee can accept
    ///   in; `0` cancels the pending offer.
    ///
    /// # Errors
    ///
    /// * `UseTimelock` - An offer after setup.
    /// * `RoleTransferError::InvalidLiveUntilLedger` - The ledger has passed or
    ///   is beyond the longest entry lifetime.
    /// * `RoleTransferError::NoPendingTransfer` - Nothing to cancel.
    /// * `RoleTransferError::InvalidPendingAccount` - The cancel names another
    ///   nominee.
    ///
    /// # Events
    ///
    /// * `AdminTransferInitiated`
    ///
    /// # Authorization
    ///
    /// The admin signs.
    fn transfer_admin_role(e: &Env, new_admin: Address, live_until_ledger: u32) {
        guards::direct_hand_over_allowed(e, live_until_ledger);
        access_control::transfer_admin_role(e, &new_admin, live_until_ledger);
    }

    /// Makes the nominee of a pending hand-over the admin. Refused while the
    /// vault winds down: no admin power changes hands then.
    ///
    /// # Errors
    ///
    /// * `WindDownActive` - The vault is winding down.
    /// * `RoleTransferError::NoPendingTransfer` - No offer is pending.
    /// * `RoleTransferError::TransferExpired` - The offer's last ledger has
    ///   passed.
    ///
    /// # Events
    ///
    /// * `AdminTransferCompleted`
    ///
    /// # Authorization
    ///
    /// The nominee signs.
    fn accept_admin_transfer(e: &Env) {
        guards::not_winding_down(e);
        access_control::accept_admin_transfer(e);
    }

    /// Refused. A role admin could grant that role with no delay.
    ///
    /// # Arguments
    ///
    /// * `role`, `admin_role` - Not read.
    ///
    /// # Errors
    ///
    /// * `UseTimelock` - Always.
    fn set_role_admin(e: &Env, _role: Symbol, _admin_role: Symbol) {
        panic_with_error!(e, VaultError::UseTimelock);
    }

    /// Refused. A vault without an admin could never be unpaused, never set a
    /// custodian, never rotate a role and never be upgraded again. The way out
    /// is a hand-over: propose and apply an `Admin` change
    /// (`transfer_admin_role` during setup), then the nominee calls
    /// `accept_admin_transfer`.
    ///
    /// # Errors
    ///
    /// * `AdminRequired` - Always.
    fn renounce_admin(e: &Env) {
        panic_with_error!(e, VaultError::AdminRequired);
    }
}

#[contractimpl(contracttrait)]
impl Pausable for AsyncVault {
    /// Pauses the vault: no deposit request, no pricing, and no timelocked
    /// change on the kit lands; pending changes wait longer by the time
    /// paused. Claims, cancellations and redemption requests stay open.
    ///
    /// # Arguments
    ///
    /// * `caller` - A `guardian` holder.
    ///
    /// # Errors
    ///
    /// * `AccessControlError::Unauthorized` - `caller` lacks `guardian`.
    /// * `PausableError::EnforcedPause` - The vault is already paused.
    ///
    /// # Events
    ///
    /// * `Paused`
    ///
    /// # Authorization
    ///
    /// `caller` signs.
    #[only_role(caller, "guardian")]
    fn pause(e: &Env, caller: Address) {
        pausable::pause(e);
        strata_timelock::pause::start(e);
    }

    /// Lifts the vault's pause.
    ///
    /// # Arguments
    ///
    /// * `caller` - The admin.
    ///
    /// # Errors
    ///
    /// * `AdminRequired` - `caller` is not the admin.
    /// * `PausableError::ExpectedPause` - The vault is not paused.
    ///
    /// # Events
    ///
    /// * `Unpaused`
    ///
    /// # Authorization
    ///
    /// `caller` signs.
    fn unpause(e: &Env, caller: Address) {
        guards::caller_is_admin(e, &caller);
        caller.require_auth();
        pausable::unpause(e);
        strata_timelock::pause::end(e);
    }
}

#[contractimpl(contracttrait)]
impl ClockSource for AsyncVault {
    /// The clock the kit's timelocks run on: the upgrade delay and the notice
    /// in seconds, the seconds spent paused, and whether the vault is paused
    /// or winding down.
    fn timelock_clock(e: &Env) -> Clock {
        governance::clock(e)
    }
}

impl TimelockHost for AsyncVault {
    fn clock(e: &Env) -> Result<Clock, Refusal> {
        Ok(governance::clock(e))
    }
}

#[cfg(test)]
mod test;
