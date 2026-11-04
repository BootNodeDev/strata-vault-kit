// The lint fires on the code `contracttype` generates, which an allow on the enum does not reach.
#![allow(clippy::enum_variant_names)]

use soroban_sdk::contracttype;

/// Each name becomes a storage key in the contract that keeps the queue, so
/// the prefix keeps these apart from the contract's own keys.
#[contracttype]
pub(crate) enum Key {
    TimelockNextId,
    TimelockOpen,
    TimelockPending(u32),
    TimelockSource,
    TimelockSetupDone,
    TimelockPausedSecs,
    TimelockPausedSince,
}
