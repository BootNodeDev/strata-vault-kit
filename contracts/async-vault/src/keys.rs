use soroban_sdk::{contracttype, Address};

#[contracttype]
pub(crate) enum DataKey {
    Asset,
    Manager,
    CurrentEpoch,
    Epoch(u64),
    UserDeposit(u64, Address),
}
