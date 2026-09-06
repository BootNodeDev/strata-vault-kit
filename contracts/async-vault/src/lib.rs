#![no_std]

mod state;

use soroban_sdk::{contract, contractimpl, Address, Env};

use state::{DataKey, FIRST_EPOCH};

pub use state::{EpochInfo, EpochStatus};

#[contract]
pub struct AsyncVault;

#[contractimpl]
impl AsyncVault {
    pub fn __constructor(e: &Env, asset: Address, manager: Address) {
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
}

#[cfg(test)]
mod test;
