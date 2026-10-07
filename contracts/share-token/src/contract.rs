use crate::error::ShareTokenError;
use crate::roles::COMPLIANCE_ROLE;

use soroban_sdk::{
    contract, contractimpl, panic_with_error, Address, Env, MuxedAddress, String, Symbol, Vec,
};
use stellar_access::access_control::{self as access_control, AccessControl};
use stellar_contract_utils::pausable::{self as pausable, Pausable};
use stellar_macros::{only_admin, only_any_role, only_role};
use stellar_tokens::{
    fungible::{Base, FungibleToken},
    rwa::{RWAToken, RWA},
};

#[contract]
pub struct ShareToken;

#[contractimpl]
impl ShareToken {
    pub fn __constructor(
        e: &Env,
        name: String,
        symbol: String,
        admin: Address,
        compliance_authority: Address,
        compliance: Address,
        identity_verifier: Address,
    ) {
        Base::set_metadata(e, 7, name, symbol);
        access_control::set_admin(e, &admin);
        access_control::grant_role_no_auth(
            e,
            &compliance_authority,
            &Symbol::new(e, COMPLIANCE_ROLE),
            &admin,
        );
        RWA::set_compliance(e, &compliance);
        RWA::set_identity_verifier(e, &identity_verifier);
    }
}

#[contractimpl(contracttrait)]
impl Pausable for ShareToken {
    #[only_admin]
    fn pause(e: &Env, caller: Address) {
        caller.require_auth();
        pausable::pause(e);
    }
    #[only_admin]
    fn unpause(e: &Env, caller: Address) {
        caller.require_auth();
        pausable::unpause(e);
    }
}

#[contractimpl(contracttrait)]
impl FungibleToken for ShareToken {
    type ContractType = RWA;
}

#[contractimpl(contracttrait)]
impl AccessControl for ShareToken {
    /// Refused. A token without an admin could never be unpaused, never rotate
    /// the manager role and never replace the vault that holds it.
    /// `transfer_admin_role` and `accept_admin_transfer` are the way out.
    fn renounce_admin(e: &Env) {
        panic_with_error!(e, ShareTokenError::AdminRequired);
    }
}

#[contractimpl(contracttrait)]
impl RWAToken for ShareToken {
    #[only_role(operator, "manager")]
    fn mint(e: &Env, to: Address, amount: i128, operator: Address) {
        RWA::mint(e, &to, amount);
    }
    #[only_role(operator, "manager")]
    fn burn(e: &Env, user_address: Address, amount: i128, operator: Address) {
        RWA::burn(e, &user_address, amount);
    }
    /// The vault escrows redemptions through it; compliance intervenes with it.
    #[only_any_role(operator, ["manager", "compliance"])]
    fn forced_transfer(e: &Env, from: Address, to: Address, amount: i128, operator: Address) {
        RWA::forced_transfer(e, &from, &to, amount);
    }
    #[only_role(operator, "compliance")]
    fn recover_balance(
        e: &Env,
        old_account: Address,
        new_account: Address,
        operator: Address,
    ) -> bool {
        RWA::recover_balance(e, &old_account, &new_account)
    }
    #[only_role(operator, "compliance")]
    fn set_address_frozen(e: &Env, user_address: Address, freeze: bool, operator: Address) {
        RWA::set_address_frozen(e, &user_address, freeze);
    }
    #[only_role(operator, "compliance")]
    fn freeze_partial_tokens(e: &Env, user_address: Address, amount: i128, operator: Address) {
        RWA::freeze_partial_tokens(e, &user_address, amount);
    }
    #[only_role(operator, "compliance")]
    fn unfreeze_partial_tokens(e: &Env, user_address: Address, amount: i128, operator: Address) {
        RWA::unfreeze_partial_tokens(e, &user_address, amount);
    }
    #[only_admin]
    fn set_compliance(e: &Env, compliance: Address, operator: Address) {
        operator.require_auth();
        RWA::set_compliance(e, &compliance);
    }
    #[only_admin]
    fn set_identity_verifier(e: &Env, identity_verifier: Address, operator: Address) {
        operator.require_auth();
        RWA::set_identity_verifier(e, &identity_verifier);
    }
}
