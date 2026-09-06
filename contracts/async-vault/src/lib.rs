#![no_std]

mod deposit;
mod error;
mod event;
mod keys;
mod state;

use soroban_sdk::{contract, contractimpl, Address, Env};
use stellar_access::access_control;
use stellar_contract_utils::pausable::{self as pausable, Pausable};
use stellar_macros::{only_admin, when_not_paused};

use keys::DataKey;
use state::FIRST_EPOCH;

pub use error::VaultError;
pub use event::DepositRequested;
pub use state::{DepositRequest, EpochInfo, EpochStatus};

#[contract]
pub struct AsyncVault;

#[contractimpl]
impl AsyncVault {
    pub fn __constructor(e: &Env, asset: Address, manager: Address, admin: Address) {
        access_control::set_admin(e, &admin);

        state::set_addr(e, &DataKey::Asset, &asset);
        state::set_addr(e, &DataKey::Manager, &manager);

        state::set_epoch(
            e,
            FIRST_EPOCH,
            &EpochInfo {
                status: EpochStatus::Open,
                total_deposited: 0,
                share_price: 0,
            },
        );
    }

    pub fn asset(e: &Env) -> Address {
        state::get_addr(e, &DataKey::Asset)
    }

    pub fn manager(e: &Env) -> Address {
        state::get_addr(e, &DataKey::Manager)
    }

    pub fn get_epoch(e: &Env, epoch_id: u64) -> Option<EpochInfo> {
        state::get_epoch(e, epoch_id)
    }

    #[when_not_paused]
    pub fn request_deposit(e: &Env, from: Address, amount: i128) -> u64 {
        deposit::request(e, &from, amount)
    }

    pub fn get_deposit_request(
        e: &Env,
        epoch_id: u64,
        controller: Address,
    ) -> Option<DepositRequest> {
        deposit::request_of(e, epoch_id, &controller)
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
