use soroban_sdk::{contracttype, panic_with_error, Address, Env};

use crate::error::VaultError;
use crate::keys::DataKey;

pub(crate) const FIRST_EPOCH: u64 = 1;

#[contracttype]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum EpochStatus {
    Open,
    Pending,
    Fulfilled,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct EpochInfo {
    pub status: EpochStatus,
    pub total_deposited: i128,
    pub total_shares_redeeming: i128,
    /// Assets per share, WAD-scaled: 1.0 is `WAD_SCALE`.
    pub share_price: i128,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct DepositRequest {
    pub amount: i128,
    pub claimed: bool,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RedeemRequest {
    pub shares: i128,
    pub claimed: bool,
}

pub(crate) fn set_addr(e: &Env, key: &DataKey, addr: &Address) {
    storage::set_instance(e, key, addr);
}

pub(crate) fn get_addr(e: &Env, key: &DataKey) -> Address {
    storage::get_instance(e, key)
        .unwrap_or_else(|| panic_with_error!(e, VaultError::NotInitialized))
}

pub(crate) fn set_current_epoch(e: &Env, id: u64) {
    storage::set_instance(e, &DataKey::CurrentEpoch, &id);
}

pub(crate) fn current_epoch(e: &Env) -> u64 {
    storage::get_instance(e, &DataKey::CurrentEpoch)
        .unwrap_or_else(|| panic_with_error!(e, VaultError::NotInitialized))
}

pub(crate) fn set_epoch(e: &Env, id: u64, epoch: &EpochInfo) {
    storage::set_persistent(e, &DataKey::Epoch(id), epoch);
}

pub(crate) fn get_epoch(e: &Env, id: u64) -> Option<EpochInfo> {
    storage::get_persistent(e, &DataKey::Epoch(id))
}

pub(crate) fn set_deposit_request(
    e: &Env,
    epoch: u64,
    controller: &Address,
    request: &DepositRequest,
) {
    storage::set_persistent(e, &DataKey::UserDeposit(epoch, controller.clone()), request);
}

pub(crate) fn get_deposit_request(
    e: &Env,
    epoch: u64,
    controller: &Address,
) -> Option<DepositRequest> {
    storage::get_persistent(e, &DataKey::UserDeposit(epoch, controller.clone()))
}

pub(crate) fn set_redeem_request(
    e: &Env,
    epoch: u64,
    controller: &Address,
    request: &RedeemRequest,
) {
    storage::set_persistent(e, &DataKey::UserRedeem(epoch, controller.clone()), request);
}

pub(crate) fn get_redeem_request(
    e: &Env,
    epoch: u64,
    controller: &Address,
) -> Option<RedeemRequest> {
    storage::get_persistent(e, &DataKey::UserRedeem(epoch, controller.clone()))
}
