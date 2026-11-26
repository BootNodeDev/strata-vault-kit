//! OpenZeppelin extends an entry when it reads it, not when it creates it.

use soroban_sdk::{Address, Env, Symbol, Vec};
use stellar_access::access_control;
use stellar_tokens::{
    fungible::{total_supply, Base},
    rwa::RWA,
};

pub(crate) fn balances(e: &Env, accounts: &[&Address]) {
    for account in accounts {
        Base::balance(e, account);
    }
}

pub(crate) fn balances_of(e: &Env, accounts: &Vec<Address>) {
    for account in accounts.iter() {
        Base::balance(e, &account);
    }
}

pub(crate) fn total_supply(e: &Env) {
    total_supply::total_supply(e);
}

pub(crate) fn address_frozen(e: &Env, account: &Address) {
    RWA::is_frozen(e, account);
}

pub(crate) fn frozen_tokens(e: &Env, account: &Address) {
    RWA::get_frozen_tokens(e, account);
}

/// The role, its member-list slot, the member count and the role list: all a grant writes.
pub(crate) fn role_entries(e: &Env, account: &Address, role: &Symbol) {
    if let Some(index) = access_control::has_role(e, account, role) {
        access_control::get_role_member(e, role, index);
    }
    access_control::get_role_member_count(e, role);
    access_control::get_existing_roles(e);
}
