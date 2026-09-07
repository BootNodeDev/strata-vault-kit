#![no_std]

mod deposit;
mod epoch;
mod error;
mod event;
mod keys;
mod roles;
mod state;

use soroban_sdk::{contract, contractimpl, Address, Env};
use stellar_access::access_control;
use stellar_contract_utils::pausable::{self as pausable, Pausable};
use stellar_macros::{only_admin, only_role, when_not_paused};

use keys::DataKey;
use roles::MANAGER_ROLE;
use state::FIRST_EPOCH;

pub use error::VaultError;
pub use event::{DepositClaimed, DepositRequested, EpochFulfilled};
pub use state::{DepositRequest, EpochInfo, EpochStatus};

#[contract]
pub struct AsyncVault;

#[contractimpl]
impl AsyncVault {
    pub fn __constructor(
        e: &Env,
        asset: Address,
        share_token: Address,
        manager: Address,
        admin: Address,
    ) {
        access_control::set_admin(e, &admin);
        access_control::grant_role_no_auth(e, &manager, &MANAGER_ROLE, &admin);

        state::set_addr(e, &DataKey::Asset, &asset);
        state::set_addr(e, &DataKey::ShareToken, &share_token);
        state::set_addr(e, &DataKey::Manager, &manager);

        state::set_epoch(e, FIRST_EPOCH, &epoch::open(0));
        state::set_current_epoch(e, FIRST_EPOCH);
    }

    pub fn asset(e: &Env) -> Address {
        state::get_addr(e, &DataKey::Asset)
    }

    pub fn share_token(e: &Env) -> Address {
        state::get_addr(e, &DataKey::ShareToken)
    }

    pub fn manager(e: &Env) -> Address {
        state::get_addr(e, &DataKey::Manager)
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

    #[only_role(caller, "manager")]
    pub fn fulfill_epoch(e: &Env, caller: Address, share_price: i128) -> u64 {
        epoch::fulfill(e, share_price)
    }
}

#[contractimpl(contracttrait)]
impl Pausable for AsyncVault {
    #[only_admin]
    fn pause(e: &Env, _caller: Address) {
        pausable::pause(e);
    }

    #[only_admin]
    fn unpause(e: &Env, _caller: Address) {
        pausable::unpause(e);
    }
}

#[cfg(test)]
mod test;
