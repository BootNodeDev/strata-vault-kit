#![no_std]

mod deposit;
mod epoch;
mod error;
mod event;
mod keys;
mod redeem;
mod roles;
mod state;
mod treasury;

use bindings::ShareClient;
use soroban_sdk::{contract, contractimpl, panic_with_error, Address, Env, Symbol, Vec};
use stellar_access::access_control::{self, AccessControl};
use stellar_contract_utils::pausable::{self as pausable, Pausable};
use stellar_macros::{only_admin, only_role, when_not_paused};

use keys::DataKey;
use roles::{GUARDIAN_ROLE, MANAGER_ROLE, TREASURY_ROLE};
use state::FIRST_EPOCH;

pub use error::VaultError;
pub use event::{
    CustodianSet, Deployed, DepositClaimed, DepositRequested, EpochClosed, EpochFulfilled, Funded,
    RedeemClaimed, RedeemRequested,
};
pub use roles::VaultRoles;
pub use state::{DepositRequest, EpochInfo, EpochStatus, RedeemRequest};

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

    pub fn pending_mint_shares(e: &Env) -> i128 {
        state::pending_mint_shares(e)
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

    #[only_role(caller, "treasury")]
    pub fn deploy_to_custodian(e: &Env, caller: Address, assets: i128) -> i128 {
        treasury::deploy(e, assets)
    }

    pub fn fund(e: &Env, from: Address, assets: i128) -> i128 {
        treasury::fund(e, &from, assets)
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
impl AccessControl for AsyncVault {}

#[contractimpl(contracttrait)]
impl Pausable for AsyncVault {
    #[only_role(caller, "guardian")]
    fn pause(e: &Env, caller: Address) {
        pausable::pause(e);
    }

    #[only_admin]
    fn unpause(e: &Env, _caller: Address) {
        pausable::unpause(e);
    }
}

#[cfg(test)]
mod test;
