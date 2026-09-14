#![no_std]

use soroban_sdk::{contractclient, contracttype, Address, Env};

#[contracttype]
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum OracleState {
    Valid,
    Stale,
    Paused,
}

#[contractclient(name = "OracleFeedClient")]
pub trait OracleFeed {
    fn state(e: &Env) -> OracleState;
    fn nav_per_share(e: &Env) -> i128;
    fn ensure_consumable(e: &Env);
}

#[contractclient(name = "ShareClient")]
pub trait Share {
    fn mint(e: &Env, to: Address, amount: i128, operator: Address);
    fn burn(e: &Env, user_address: Address, amount: i128, operator: Address);
    fn forced_transfer(e: &Env, from: Address, to: Address, amount: i128, operator: Address);
    fn transfer(e: &Env, from: Address, to: Address, amount: i128);
    fn total_supply(e: &Env) -> i128;
    fn balance(e: &Env, id: Address) -> i128;
}
