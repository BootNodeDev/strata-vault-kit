//! Pause accounting for the contract that owns the clock. The contracts bound
//! to it read the total through `ClockSource`.

use soroban_sdk::Env;

use crate::keys::Key;

/// A second start while paused changes nothing.
pub fn start(e: &Env) {
    let since: Option<u64> = storage::get_instance(e, &Key::TimelockPausedSince);
    if since.is_none() {
        storage::set_instance(e, &Key::TimelockPausedSince, &e.ledger().timestamp());
    }
}

/// Banks the time since `start`. An end with no pause running changes nothing.
pub fn end(e: &Env) {
    let since: Option<u64> = storage::get_instance(e, &Key::TimelockPausedSince);
    if let Some(since) = since {
        let total = closed_secs(e).saturating_add(e.ledger().timestamp().saturating_sub(since));
        storage::set_instance(e, &Key::TimelockPausedSecs, &total);
        e.storage().instance().remove(&Key::TimelockPausedSince);
    }
}

/// Seconds spent paused so far, a running pause included.
pub fn paused_secs(e: &Env) -> u64 {
    let since: Option<u64> = storage::get_instance(e, &Key::TimelockPausedSince);
    let running = since.map_or(0, |s| e.ledger().timestamp().saturating_sub(s));
    closed_secs(e).saturating_add(running)
}

fn closed_secs(e: &Env) -> u64 {
    storage::get_instance(e, &Key::TimelockPausedSecs).unwrap_or(0)
}
