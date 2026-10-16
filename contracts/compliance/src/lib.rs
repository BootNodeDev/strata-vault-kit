//! Testnet-only stub — in production this is an external modular-compliance
//! module (ERC-3643), not part of this product. Do not deploy to mainnet.
#![no_std]

use soroban_sdk::{contract, contractimpl, contractmeta, Address, Env, Vec};

contractmeta!(
    key = "stub",
    val = "testnet-only; prod = external compliance module"
);
use stellar_access::access_control;
use stellar_macros::only_admin;
use stellar_tokens::rwa::{compliance, compliance::ComplianceHook, utils::token_binder};

#[contract]
pub struct Compliance;

#[contractimpl]
impl Compliance {
    pub fn __constructor(e: &Env, admin: Address) {
        access_control::set_admin(e, &admin);
        storage::bump_instance(e);
    }
}

#[contractimpl(contracttrait)]
impl token_binder::TokenBinder for Compliance {
    #[only_admin]
    fn bind_token(e: &Env, token: Address, _operator: Address) {
        storage::bump_instance(e);
        token_binder::bind_token(e, &token);
    }

    #[only_admin]
    fn unbind_token(e: &Env, token: Address, _operator: Address) {
        storage::bump_instance(e);
        token_binder::unbind_token(e, &token);
    }
}

/// The token calls the check before and the hook after every mint, burn and
/// transfer, which is what keeps this instance alive.
#[contractimpl(contracttrait)]
impl compliance::Compliance for Compliance {
    #[only_admin]
    fn add_module_to(e: &Env, hook: ComplianceHook, module: Address, _operator: Address) {
        storage::bump_instance(e);
        compliance::storage::add_module_to(e, hook, module);
    }

    #[only_admin]
    fn remove_module_from(e: &Env, hook: ComplianceHook, module: Address, _operator: Address) {
        storage::bump_instance(e);
        compliance::storage::remove_module_from(e, hook, module);
    }

    fn transferred(e: &Env, from: Address, to: Address, amount: i128, token: Address) {
        storage::bump_instance(e);
        compliance::storage::transferred(e, from, to, amount, token);
    }

    fn created(e: &Env, to: Address, amount: i128, token: Address) {
        storage::bump_instance(e);
        compliance::storage::created(e, to, amount, token);
    }

    fn destroyed(e: &Env, from: Address, amount: i128, token: Address) {
        storage::bump_instance(e);
        compliance::storage::destroyed(e, from, amount, token);
    }

    fn can_transfer(e: &Env, from: Address, to: Address, amount: i128, token: Address) -> bool {
        storage::bump_instance(e);
        compliance::storage::can_transfer(e, from, to, amount, token)
    }

    fn can_create(e: &Env, to: Address, amount: i128, token: Address) -> bool {
        storage::bump_instance(e);
        compliance::storage::can_create(e, to, amount, token)
    }
}

#[cfg(test)]
mod test;
