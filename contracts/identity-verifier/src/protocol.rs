//! Addresses verified without an identity: the bound vault, always, and any
//! other address governance names.

use soroban_sdk::{contracttype, Address, Env};
use strata_timelock::setup;

use crate::{ProtocolAddressAdded, ProtocolAddressRemoved};

#[contracttype]
pub(crate) enum DataKey {
    Protocol(Address),
}

fn is_named(e: &Env, account: &Address) -> bool {
    strata_storage::get_persistent::<_, bool>(e, &DataKey::Protocol(account.clone()))
        .unwrap_or(false)
}

/// The bound vault is read from the instance, so it never waits on an entry
/// of its own.
pub(crate) fn is_protocol(e: &Env, account: &Address) -> bool {
    setup::source(e).as_ref() == Some(account) || is_named(e, account)
}

pub(crate) fn add(e: &Env, account: &Address) {
    if !is_protocol(e, account) {
        strata_storage::set_persistent(e, &DataKey::Protocol(account.clone()), &true);
        publish_added(e, account);
    }
}

pub(crate) fn remove(e: &Env, account: &Address) {
    let key = DataKey::Protocol(account.clone());
    if e.storage().persistent().has(&key) {
        e.storage().persistent().remove(&key);
        ProtocolAddressRemoved {
            account: account.clone(),
        }
        .publish(e);
    }
}

pub(crate) fn publish_added(e: &Env, account: &Address) {
    ProtocolAddressAdded {
        account: account.clone(),
    }
    .publish(e);
}
