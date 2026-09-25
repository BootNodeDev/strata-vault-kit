#![no_std]

mod deposit;
mod epoch;
mod error;
mod event;
mod keys;
mod pricing;
mod redeem;
mod roles;
mod state;
mod timing;
mod treasury;
mod upgrade;
mod wind_down;

use bindings::ShareClient;
use soroban_sdk::{contract, contractimpl, panic_with_error, Address, BytesN, Env, Symbol, Vec};
use stellar_access::access_control::{self, AccessControl};
use stellar_contract_utils::pausable::{self as pausable, Pausable};
use stellar_contract_utils::upgradeable;
use stellar_macros::{only_admin, only_role, when_not_paused};

use keys::DataKey;
use roles::{GUARDIAN_ROLE, MANAGER_ROLE, TREASURY_ROLE};
use state::FIRST_EPOCH;

pub use error::VaultError;
pub use event::{
    CustodianSet, Deployed, DepositClaimed, DepositRequested, EpochClosed, EpochFulfilled, Funded,
    NoticeSet, RedeemClaimed, RedeemRequested, UpgradeCancelled, UpgradeDelayProposed,
    UpgradeDelaySet, UpgradeProposed, Upgraded, WindDownActivated, WindDownClaimed,
    WindDownDelaySet, WindDownProposalCancelled, WindDownProposed, WindDownRoundFinalized,
};
pub use pricing::{DirectUnitPricing, PricingScheme};
pub use roles::VaultRoles;
pub use state::{DepositRequest, EpochInfo, EpochStatus, RedeemRequest};
pub use upgrade::{UpgradeAction, UpgradeProposal, MAX_UPGRADE_DELAY, MIN_UPGRADE_DELAY};
pub use wind_down::{WindDownInfo, WindDownPosition, WindDownStatus, MAX_WIND_DOWN_DELAY};

/// Thirty days. Longer than any notice a real structure uses, short enough that
/// setting it by mistake is survivable.
pub const MAX_NOTICE_SECS: u64 = 30 * 24 * 60 * 60;

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
        let client = ShareClient::new(e, &share_token);
        let total_supply = client.total_supply();
        let vault_escrow = client.balance(&e.current_contract_address());
        let circulating = total_supply.saturating_sub(vault_escrow);
        circulating
            .checked_add(state::pending_mint_shares(e))
            .unwrap_or_else(|| panic_with_error!(e, VaultError::AmountTooLarge))
    }

    #[only_admin]
    pub fn set_custodian(e: &Env, custodian: Address, _caller: Address) {
        treasury::set_custodian(e, &custodian);
    }

    #[only_admin]
    pub fn set_wind_down_delay(e: &Env, secs: u64, _caller: Address) {
        wind_down::set_delay(e, secs);
    }

    pub fn wind_down_delay(e: &Env) -> u64 {
        wind_down::delay(e)
    }

    pub fn wind_down(e: &Env) -> Option<WindDownInfo> {
        wind_down::info(e)
    }

    #[only_admin]
    pub fn propose_wind_down(e: &Env, _caller: Address) {
        wind_down::propose(e);
    }

    #[only_admin]
    pub fn cancel_wind_down_proposal(e: &Env, _caller: Address) {
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

    /// Surrenders whatever the holder holds and pays their share of every round
    /// finalised since they last claimed.
    pub fn claim_wind_down(e: &Env, holder: Address) -> i128 {
        wind_down::claim(e, &holder)
    }

    pub fn wind_down_claimable(e: &Env, holder: Address) -> i128 {
        wind_down::claimable(e, &holder)
    }

    #[only_admin]
    pub fn set_notice(e: &Env, secs: u64, _caller: Address) {
        if secs > MAX_NOTICE_SECS {
            panic_with_error!(e, VaultError::NoticeTooLong);
        }
        if secs > upgrade::delay(e) {
            panic_with_error!(e, VaultError::NoticeAboveUpgradeDelay);
        }
        state::set_notice(e, secs);
        NoticeSet { secs }.publish(e);
    }

    #[only_admin]
    pub fn propose_upgrade(e: &Env, wasm_hash: BytesN<32>, _caller: Address) {
        upgrade::propose_wasm(e, wasm_hash);
    }

    #[only_admin]
    pub fn propose_upgrade_delay(e: &Env, secs: u64, _caller: Address) {
        upgrade::propose_delay(e, secs);
    }

    #[only_admin]
    pub fn cancel_upgrade(e: &Env, _caller: Address) {
        upgrade::cancel(e);
    }

    #[only_admin]
    #[when_not_paused]
    pub fn apply_upgrade(e: &Env, _caller: Address) {
        upgrade::apply(e);
    }

    pub fn upgrade_delay(e: &Env) -> u64 {
        upgrade::delay(e)
    }

    pub fn upgrade_proposal(e: &Env) -> Option<UpgradeProposal> {
        upgrade::proposal(e)
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

    pub fn claim_deposit(e: &Env, caller: Address, epoch_id: u64) -> i128 {
        deposit::claim(e, &caller, epoch_id)
    }

    /// Cancels an unpriced deposit. Never blocked by the pause.
    pub fn cancel_deposit(e: &Env, from: Address, epoch_id: u64) -> i128 {
        deposit::cancel(e, &from, epoch_id)
    }

    /// Cancels an unpriced redemption. Refused for a controller the share token
    /// will not let hold shares; that controller exits through the cash claim.
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
    /// Refused. A vault without an admin could never be unpaused, never set a
    /// custodian, never rotate a role and never be upgraded again.
    /// `transfer_admin_role` and `accept_admin_transfer` are the way out.
    fn renounce_admin(e: &Env) {
        panic_with_error!(e, VaultError::AdminRequired);
    }
}

#[contractimpl(contracttrait)]
impl Pausable for AsyncVault {
    #[only_role(caller, "guardian")]
    fn pause(e: &Env, caller: Address) {
        pausable::pause(e);
        upgrade::on_pause(e);
    }

    #[only_admin]
    fn unpause(e: &Env, _caller: Address) {
        pausable::unpause(e);
        upgrade::on_unpause(e);
    }
}

#[cfg(test)]
mod test;
