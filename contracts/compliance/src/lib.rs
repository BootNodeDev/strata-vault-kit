#![no_std]

use soroban_sdk::{contract, contractimpl, Address, Env, Vec};
use stellar_access::access_control;
use stellar_macros::only_admin;
use stellar_tokens::rwa::{compliance, compliance::ComplianceHook, utils::token_binder};

#[contract]
pub struct Compliance;

#[contractimpl]
impl Compliance {
    pub fn __constructor(e: &Env, admin: Address) {
        access_control::set_admin(e, &admin);
    }
}

#[contractimpl(contracttrait)]
impl token_binder::TokenBinder for Compliance {
    #[only_admin]
    fn bind_token(e: &Env, token: Address, _operator: Address) {
        token_binder::bind_token(e, &token);
    }

    #[only_admin]
    fn unbind_token(e: &Env, token: Address, _operator: Address) {
        token_binder::unbind_token(e, &token);
    }
}

#[contractimpl(contracttrait)]
impl compliance::Compliance for Compliance {
    #[only_admin]
    fn add_module_to(e: &Env, hook: ComplianceHook, module: Address, _operator: Address) {
        compliance::storage::add_module_to(e, hook, module);
    }

    #[only_admin]
    fn remove_module_from(e: &Env, hook: ComplianceHook, module: Address, _operator: Address) {
        compliance::storage::remove_module_from(e, hook, module);
    }
}
