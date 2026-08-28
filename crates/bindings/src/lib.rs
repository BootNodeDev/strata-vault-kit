#![no_std]

use soroban_sdk::{contractclient, contracttype, Address, Env};

#[contracttype]
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum OracleState {
    Valid,
    Stale,
}

#[contractclient(name = "OracleFeedClient")]
pub trait OracleFeed {
    fn state(e: &Env) -> OracleState;
    fn nav_per_share(e: &Env) -> i128;
}

#[contractclient(name = "ShareClient")]
pub trait Share {
    fn mint(e: &Env, to: Address, amount: i128);
    fn burn(e: &Env, from: Address, amount: i128);
}
