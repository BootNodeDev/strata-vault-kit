use soroban_sdk::{contracttype, Address, Env};

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
    pub share_price: i128,
}

#[contracttype]
pub(crate) enum DataKey {
    Asset,
    Manager,
    Epoch(u64),
    UserDeposit(u64, Address),
}

pub(crate) fn set_addr(e: &Env, key: &DataKey, addr: &Address) {
    storage::set_instance(e, key, addr);
}

pub(crate) fn get_addr(e: &Env, key: &DataKey) -> Address {
    storage::get_instance(e, key).unwrap()
}

pub(crate) fn set_epoch(e: &Env, id: u64, epoch: &EpochInfo) {
    storage::set_persistent(e, &DataKey::Epoch(id), epoch);
}

pub(crate) fn get_epoch(e: &Env, id: u64) -> Option<EpochInfo> {
    storage::get_persistent(e, &DataKey::Epoch(id))
}
