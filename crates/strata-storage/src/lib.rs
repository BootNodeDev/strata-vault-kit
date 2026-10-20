//! # Design
//!
//! Storage helpers that keep the kit's own entries alive. Every read and every
//! write through them asks the network to renew the entry it touches.
//!
//! - **Thirty days, renewed a day short.** Each entry, the instance included,
//!   goes back to 30 days once it falls a day short. The cost: a busy entry
//!   costs about a day of rent per day; an idle one archives.
//! - **Extended in the call that creates it.** A write renews too, so a new
//!   entry starts with at least its target. The cost: that call pays for it, or
//!   for the network's minimum when that is longer.
//! - **The same lengths on every network,** fixed in code, so the Wasm tested
//!   on testnet is the one that ships; each network's minimum lifetime is a
//!   floor for new entries. The cost: no lengths tuned per network.
//! - **No cap per call.** A cap would let rarely read entries archive sooner,
//!   and a mainnet restore pays at least 120 days of rent. The cost: the first
//!   call after a quiet spell renews all it touches.

#![no_std]

use core::fmt::Debug;

use soroban_sdk::{Env, IntoVal, TryFromVal, Val};

const DAY_IN_LEDGERS: u32 = 17280;

pub const PERSISTENT_EXTEND_AMOUNT: u32 = 30 * DAY_IN_LEDGERS;
pub const PERSISTENT_TTL_THRESHOLD: u32 = PERSISTENT_EXTEND_AMOUNT - DAY_IN_LEDGERS;
pub const INSTANCE_EXTEND_AMOUNT: u32 = 30 * DAY_IN_LEDGERS;
pub const INSTANCE_TTL_THRESHOLD: u32 = INSTANCE_EXTEND_AMOUNT - DAY_IN_LEDGERS;

pub fn bump_instance(e: &Env) {
    e.storage()
        .instance()
        .extend_ttl(INSTANCE_TTL_THRESHOLD, INSTANCE_EXTEND_AMOUNT);
}

pub fn set_instance<K, V>(e: &Env, key: &K, val: &V)
where
    K: IntoVal<Env, Val>,
    V: IntoVal<Env, Val>,
{
    e.storage().instance().set(key, val);
    bump_instance(e);
}

pub fn get_instance<K, V>(e: &Env, key: &K) -> Option<V>
where
    K: IntoVal<Env, Val>,
    V: TryFromVal<Env, Val>,
    <V as TryFromVal<Env, Val>>::Error: Debug,
{
    let val: Option<V> = e.storage().instance().get(key);
    if val.is_some() {
        bump_instance(e);
    }
    val
}

pub fn set_persistent<K, V>(e: &Env, key: &K, val: &V)
where
    K: IntoVal<Env, Val>,
    V: IntoVal<Env, Val>,
{
    let storage = e.storage().persistent();
    storage.set(key, val);
    storage.extend_ttl(key, PERSISTENT_TTL_THRESHOLD, PERSISTENT_EXTEND_AMOUNT);
}

pub fn get_persistent<K, V>(e: &Env, key: &K) -> Option<V>
where
    K: IntoVal<Env, Val>,
    V: TryFromVal<Env, Val>,
    <V as TryFromVal<Env, Val>>::Error: Debug,
{
    let storage = e.storage().persistent();
    let val: Option<V> = storage.get(key);
    if val.is_some() {
        storage.extend_ttl(key, PERSISTENT_TTL_THRESHOLD, PERSISTENT_EXTEND_AMOUNT);
    }
    val
}

#[cfg(test)]
mod test;
