use soroban_sdk::{
    contract, contractimpl, symbol_short, Address, Env, MuxedAddress, String, Symbol, Vec,
};
use stellar_access::access_control::{self as access_control, AccessControl};
use stellar_tokens::{
    fungible::{Base, FungibleToken},
    rwa::RWA,
};

/// Operator role for privileged token actions (mint/burn). The vault holds it.
const MANAGER_ROLE: Symbol = symbol_short!("manager");

#[contract]
pub struct ShareToken;

#[contractimpl]
impl ShareToken {
    pub fn __constructor(
        e: &Env,
        name: String,
        symbol: String,
        admin: Address,
        manager: Address,
        compliance: Address,
        identity_verifier: Address,
    ) {
        Base::set_metadata(e, 7, name, symbol);

        access_control::set_admin(e, &admin);
        access_control::grant_role_no_auth(e, &manager, &MANAGER_ROLE, &admin);

        RWA::set_compliance(e, &compliance);
        RWA::set_identity_verifier(e, &identity_verifier);
    }
}

#[contractimpl(contracttrait)]
impl FungibleToken for ShareToken {
    type ContractType = RWA;
}

#[contractimpl(contracttrait)]
impl AccessControl for ShareToken {}
