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
