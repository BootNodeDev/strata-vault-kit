#![no_std]

mod deposit;
mod epoch;
mod error;
mod event;
mod governance;
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
use timelock::{Clock, ClockSource, Refusal, TimelockHost, DAY_DURATION};

use keys::DataKey;
use roles::{GUARDIAN_ROLE, MANAGER_ROLE, TREASURY_ROLE};
use state::FIRST_EPOCH;

pub use error::VaultError;
pub use event::{
    ChangeApplied, ChangeCancelled, ChangeProposed, CustodianSet, Deployed, DepositCapUpdated,
    DepositClaimed, DepositConvertedToExit, DepositRequested, EpochClosed, EpochFulfilled,
    EpochReconciled, Funded, NoticeSet, RedeemClaimed, RedeemRequested, RedemptionSurrendered,
    SetupFinished, WindDownActivated, WindDownClaimed, WindDownDelaySet, WindDownProposalCancelled,
    WindDownProposed, WindDownRoundFinalized,
};
pub use governance::{VaultChange, VaultPendingChange, ADMIN_ACCEPT_LEDGERS};
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
    pub fn __constructor(
        e: &Env,
        asset: Address,
        share_token: Address,
        oracle: Address,
        roles: VaultRoles,
    ) {
        // The vault kit white-label topology specifies five distinct authorities:
        // governance, manager, treasury, guardian, compliance, and attester.
        // Although compliance is enforced on the identity verifier and attestation
        // on the NAV oracle, the vault checks pairwise distinctness at construction
        // time to prevent role misconfiguration across the kit ecosystem. Neither
        // compliance nor attester is granted a direct role on the vault contract itself.
        if roles.treasury == roles.guardian
            || roles.treasury == roles.governance
            || roles.compliance == roles.governance
            || roles.compliance == roles.treasury
        {
            panic_with_error!(e, VaultError::RolesNotDistinct);
        }

        access_control::set_admin(e, &roles.governance);
        access_control::grant_role_no_auth(e, &roles.manager, &MANAGER_ROLE, &roles.governance);
        access_control::grant_role_no_auth(e, &roles.treasury, &TREASURY_ROLE, &roles.governance);
        access_control::grant_role_no_auth(e, &roles.guardian, &GUARDIAN_ROLE, &roles.governance);

        state::set_addr(e, &DataKey::Asset, &asset);
        state::set_addr(e, &DataKey::ShareToken, &share_token);
        state::set_addr(e, &DataKey::Oracle, &oracle);

        state::set_epoch(e, FIRST_EPOCH, &epoch::open(0));
        state::set_current_epoch(e, FIRST_EPOCH);
        upgradeable::set_schema_version(e, 1);
    }

    pub fn asset(e: &Env) -> Address {
        state::get_addr(e, &DataKey::Asset)
    }

    pub fn share_token(e: &Env) -> Address {
        state::get_addr(e, &DataKey::ShareToken)
    }

    pub fn oracle(e: &Env) -> Address {
        state::get_addr(e, &DataKey::Oracle)
    }

    pub fn governance(e: &Env) -> Option<Address> {
        access_control::get_admin(e)
    }

    pub fn manager(e: &Env) -> Option<Address> {
        role_holder(e, &MANAGER_ROLE)
    }

    pub fn treasury(e: &Env) -> Option<Address> {
        role_holder(e, &TREASURY_ROLE)
    }

    pub fn guardian(e: &Env) -> Option<Address> {
        role_holder(e, &GUARDIAN_ROLE)
    }

    pub fn custodian(e: &Env) -> Option<Address> {
        state::get_addr_opt(e, &DataKey::Custodian)
    }

    pub fn net_deployed(e: &Env) -> i128 {
        state::net_deployed(e)
    }

    pub fn free_reserve(e: &Env) -> i128 {
        treasury::free_reserve(e)
    }

    pub fn committed(e: &Env) -> i128 {
        state::committed(e)
    }

    pub fn uncovered(e: &Env) -> i128 {
        treasury::uncovered(e)
    }

    pub fn liquid_reserve(e: &Env) -> i128 {
        treasury::liquid_reserve(e)
    }

    pub fn cancellable_escrow(e: &Env) -> i128 {
        state::cancellable_escrow(e)
    }

    pub fn pending_mint_shares(e: &Env) -> i128 {
        state::pending_mint_shares(e)
    }

    pub fn pending_burn_shares(e: &Env) -> i128 {
        state::pending_burn_shares(e)
    }

    pub fn total_economic_supply(e: &Env) -> i128 {
        let share_token = state::get_addr(e, &DataKey::ShareToken);
        let client = FungibleTokenClient::new(e, &share_token);
        let total_supply = client.total_supply();
        let vault_escrow = client.balance(&e.current_contract_address());
        let circulating = total_supply.saturating_sub(vault_escrow);
        circulating
            .checked_add(state::pending_mint_shares(e))
            .unwrap_or_else(|| panic_with_error!(e, VaultError::AmountTooLarge))
    }

    pub fn deposit_cap(e: &Env) -> Option<i128> {
        state::deposit_cap(e)
    }

    #[only_admin]
    pub fn set_deposit_cap(e: &Env, cap: Option<i128>, caller: Address) {
        caller.require_auth();
        if let Some(c) = cap {
            if c < 0 {
                panic_with_error!(e, VaultError::InvalidAmount);
            }
        }
        let old_cap = state::deposit_cap(e);
        state::set_deposit_cap(e, cap);
        DepositCapUpdated {
            old_cap,
            new_cap: cap,
        }
        .publish(e);
    }

    /// Instant during setup; afterwards the custodian changes through the
    /// timelock.
    #[only_admin]
    pub fn set_custodian(e: &Env, custodian: Address, caller: Address) {
        caller.require_auth();
        governance::require_setup_open(e);
        treasury::set_custodian(e, &custodian);
    }

    /// Raising is instant. Lowering shortens the warning holders get before a
    /// wind-down starts, so after setup it waits for the timelock.
    #[only_admin]
    pub fn set_wind_down_delay(e: &Env, secs: u64, caller: Address) {
        caller.require_auth();
        wind_down::check_delay(e, secs);
        if secs < wind_down::delay(e) {
            governance::require_setup_open(e);
        }
        wind_down::set_delay(e, secs);
    }

    pub fn wind_down_delay(e: &Env) -> u64 {
        wind_down::delay(e)
    }

    pub fn wind_down(e: &Env) -> Option<WindDownInfo> {
        wind_down::info(e)
    }

    #[only_admin]
    pub fn propose_wind_down(e: &Env, caller: Address) {
        caller.require_auth();
        wind_down::propose(e);
    }

    #[only_admin]
    pub fn cancel_wind_down_proposal(e: &Env, caller: Address) {
        caller.require_auth();
        wind_down::cancel_proposal(e);
    }

    /// Open to anyone once the delay has passed, so the operator cannot stall
    /// the wind-down it announced.
    pub fn activate_wind_down(e: &Env) {
        wind_down::activate(e);
    }

    /// Open to anyone once active, distributing the free reserve in proportion
    /// to the supply snapshot.
    pub fn finalize_wind_down_round(e: &Env) -> i128 {
        wind_down::finalize_round(e)
    }

    pub fn wind_down_owed(e: &Env) -> i128 {
        wind_down::owed(e)
    }

    pub fn wind_down_supply(e: &Env) -> i128 {
        wind_down::supply_snapshot(e)
    }

    pub fn wind_down_acc(e: &Env) -> i128 {
        wind_down::acc(e)
    }

    /// Surrenders the free shares the holder holds and pays their share of
    /// every round finalised since they last claimed. A frozen holder is
    /// refused; a partial freeze surrenders only the free shares.
    pub fn claim_wind_down(e: &Env, holder: Address) -> i128 {
        wind_down::claim(e, &holder)
    }

    pub fn wind_down_claimable(e: &Env, holder: Address) -> i128 {
        wind_down::claimable(e, &holder)
    }

    /// Raising is instant. Lowering shortens the wait every closed epoch gives
    /// before it prices, so after setup it waits for the timelock.
    #[only_admin]
    pub fn set_notice(e: &Env, secs: u64, caller: Address) {
        caller.require_auth();
        if secs < state::notice(e) {
            governance::require_setup_open(e);
        }
        governance::set_notice(e, secs);
    }

    /// Ends the window in which admin changes are instant, once the token,
    /// the oracle, the manager role, the allowlist and the compliance binding
    /// are wired to this vault and the token has no shares outstanding.
    /// Deposits open from here on, and it never reopens.
    #[only_admin]
    pub fn finish_setup(e: &Env, caller: Address) {
        caller.require_auth();
        governance::finish_setup(e);
    }

    pub fn setup_open(e: &Env) -> bool {
        timelock::setup::is_open(e)
    }

    /// Queues a change behind the timelock and returns its id.
    #[only_admin]
    pub fn propose_change(e: &Env, change: VaultChange, caller: Address) -> u32 {
        caller.require_auth();
        governance::propose(e, change)
    }

    #[only_admin]
    pub fn cancel_change(e: &Env, id: u32, caller: Address) {
        caller.require_auth();
        governance::cancel(e, id);
    }

    /// Lands a change whose delay has run. Refused while paused or winding
    /// down.
    #[only_admin]
    pub fn apply_change(e: &Env, id: u32, caller: Address) {
        caller.require_auth();
        governance::apply(e, id);
    }

    pub fn pending_changes(e: &Env) -> Vec<VaultPendingChange> {
        governance::pending(e)
    }

    pub fn upgrade_delay(e: &Env) -> u64 {
        upgrade::delay(e)
    }

    pub fn schema_version(e: &Env) -> u32 {
        upgradeable::get_schema_version(e)
    }

    #[only_role(caller, "treasury")]
    pub fn deploy_to_custodian(e: &Env, caller: Address, assets: i128) -> i128 {
        treasury::deploy(e, assets)
    }

    pub fn fund(e: &Env, from: Address, assets: i128) -> i128 {
        treasury::fund(e, &from, assets)
    }

    pub fn notice(e: &Env) -> u64 {
        state::notice(e)
    }

    pub fn current_epoch(e: &Env) -> u64 {
        state::current_epoch(e)
    }

    pub fn get_epoch(e: &Env, epoch_id: u64) -> Option<EpochInfo> {
        state::get_epoch(e, epoch_id)
    }

    /// What pricing promised the epoch and what has been paid against it.
    pub fn get_epoch_settlement(e: &Env, epoch_id: u64) -> Option<EpochSettlement> {
        settlement::get(e, epoch_id)
    }

    pub fn get_deposit_request(
        e: &Env,
        epoch_id: u64,
        controller: Address,
    ) -> Option<DepositRequest> {
        state::get_deposit_request(e, epoch_id, &controller)
    }

    #[when_not_paused]
    pub fn request_deposit(e: &Env, from: Address, amount: i128) -> u64 {
        deposit::request(e, &from, amount)
    }

    /// Returns the shares minted to the caller. Zero means none were: a deposit
    /// too small for one share was refunded, or the caller is off the allowlist
    /// and the shares joined an exit instead (`DepositConvertedToExit`).
    pub fn claim_deposit(e: &Env, caller: Address, epoch_id: u64) -> i128 {
        deposit::claim(e, &caller, epoch_id)
    }

    /// Cancels an unpriced deposit. Never blocked by the pause.
    pub fn cancel_deposit(e: &Env, from: Address, epoch_id: u64) -> i128 {
        deposit::cancel(e, &from, epoch_id)
    }

    /// Cancels an unpriced redemption. Outside a wind-down the shares come
    /// back, so a delisted or frozen controller is refused; in one the escrow
    /// joins the controller's entitlement, and a frozen controller is held.
    pub fn cancel_redeem(e: &Env, from: Address, epoch_id: u64) -> i128 {
        redeem::cancel(e, &from, epoch_id)
    }

    pub fn request_redeem(e: &Env, from: Address, shares: i128) -> u64 {
        redeem::request(e, &from, shares)
    }

    pub fn get_redeem_request(
        e: &Env,
        epoch_id: u64,
        controller: Address,
    ) -> Option<RedeemRequest> {
        state::get_redeem_request(e, epoch_id, &controller)
    }

    pub fn claim_redeem(e: &Env, caller: Address, epoch_id: u64) -> i128 {
        redeem::claim(e, &caller, epoch_id)
    }

    #[only_role(caller, "manager")]
    pub fn close_epoch(e: &Env, caller: Address) -> u64 {
        epoch::close(e)
    }

    #[when_not_paused]
    pub fn fulfill_epoch(e: &Env, epoch_id: u64) -> i128 {
        epoch::fulfill(e, epoch_id)
    }
}

#[contractimpl(contracttrait)]
impl AccessControl for AsyncVault {
    /// Instant during setup; after it, propose the grant through the timelock.
    fn grant_role(e: &Env, account: Address, role: Symbol, caller: Address) {
        governance::require_setup_open(e);
        access_control::grant_role(e, &account, &role, &caller);
    }

    /// Instant for every role but `manager`: taking `treasury` or `guardian`
    /// away moves no value. After setup, revoking `manager` waits like a grant,
    /// because without it no epoch closes and no exit is priced.
    fn revoke_role(e: &Env, account: Address, role: Symbol, caller: Address) {
        governance::require_revoke_allowed(e, &role);
        access_control::revoke_role(e, &account, &role, &caller);
    }

    /// Cancelling a pending hand-over (`live_until_ledger == 0`) keeps the
    /// current admin, so it stays instant.
    fn transfer_admin_role(e: &Env, new_admin: Address, live_until_ledger: u32) {
        if live_until_ledger != 0 {
            governance::require_setup_open(e);
        }
        access_control::transfer_admin_role(e, &new_admin, live_until_ledger);
    }

    /// Refused. A role admin could grant that role with no delay.
    fn set_role_admin(e: &Env, _role: Symbol, _admin_role: Symbol) {
        panic_with_error!(e, VaultError::UseTimelock);
    }

    /// Refused. A vault without an admin could never be unpaused, never set a
    /// custodian, never rotate a role and never be upgraded again. The way out
    /// is a hand-over: propose and apply an `Admin` change
    /// (`transfer_admin_role` during setup), then the nominee calls
    /// `accept_admin_transfer`.
    fn renounce_admin(e: &Env) {
        panic_with_error!(e, VaultError::AdminRequired);
    }
}

#[contractimpl(contracttrait)]
impl Pausable for AsyncVault {
    #[only_role(caller, "guardian")]
    fn pause(e: &Env, caller: Address) {
        pausable::pause(e);
        timelock::pause::start(e);
    }

    #[only_admin]
    fn unpause(e: &Env, caller: Address) {
        caller.require_auth();
        pausable::unpause(e);
        timelock::pause::end(e);
    }
}

#[contractimpl(contracttrait)]
impl ClockSource for AsyncVault {
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
