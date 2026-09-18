//! Stands in for a future vault version in the upgrade tests. Not deployed.
#![no_std]

use soroban_sdk::{contract, contracterror, contractimpl, panic_with_error, Address, Env};
use stellar_contract_utils::upgradeable;

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum TargetError {
    AlreadyMigrated = 1,
}

#[contract]
pub struct UpgradeTarget;

#[contractimpl]
impl UpgradeTarget {
    pub fn schema_version(e: &Env) -> u32 {
        upgradeable::get_schema_version(e)
    }

    pub fn migrate(e: &Env, caller: Address) {
        caller.require_auth();
        if upgradeable::get_schema_version(e) >= 2 {
            panic_with_error!(e, TargetError::AlreadyMigrated);
        }
        upgradeable::set_schema_version(e, 2);
    }
}
