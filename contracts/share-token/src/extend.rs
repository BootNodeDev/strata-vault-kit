//! OpenZeppelin extends an entry when it reads it, not when it creates it.

use soroban_sdk::{Address, Env};
use stellar_tokens::{fungible::Base, rwa::RWA};

pub(crate) fn balances(e: &Env, accounts: &[&Address]) {
    for account in accounts {
        Base::balance(e, account);
    }
}

pub(crate) fn address_frozen(e: &Env, account: &Address) {
    RWA::is_frozen(e, account);
}

pub(crate) fn frozen_tokens(e: &Env, account: &Address) {
    RWA::get_frozen_tokens(e, account);
}
