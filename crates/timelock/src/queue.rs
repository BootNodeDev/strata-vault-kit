use core::fmt::Debug;

use soroban_sdk::{Env, TryFromVal, Val, Vec};

use crate::clock::TimelockHost;
use crate::keys::Key;
use crate::refusal::Refusal;
use crate::schedule::Schedule;
use crate::setup;

/// Changes that may wait at once. Bounds every walk over them.
pub const MAX_PENDING: u32 = 16;

/// The ids of the changes waiting, oldest first.
pub fn open_ids(e: &Env) -> Vec<u32> {
    storage::get_instance(e, &Key::TimelockOpen).unwrap_or_else(|| Vec::new(e))
}

pub fn pending<C>(e: &Env, id: u32) -> Option<(C, Schedule)>
where
    C: TryFromVal<Env, Val>,
    <C as TryFromVal<Env, Val>>::Error: Debug,
{
    storage::get_persistent(e, &Key::TimelockPending(id))
}

/// Queues a change behind the host's current delay and returns its id.
pub fn propose<H: TimelockHost, C>(e: &Env, change: &C) -> Result<u32, Refusal>
where
    C: Clone,
    Val: TryFromVal<Env, C>,
{
    if setup::is_open(e) {
        return Err(Refusal::SetupOpen);
    }
    let clock = H::clock(e)?;
    if clock.winding_down {
        return Err(Refusal::WindingDown);
    }
    let mut open = open_ids(e);
    if open.len() >= MAX_PENDING {
        return Err(Refusal::TooMany);
    }
    let id: u32 = storage::get_instance(e, &Key::TimelockNextId).unwrap_or(1);
    let schedule = Schedule {
        proposed_at: e.ledger().timestamp(),
        delay: clock.delay,
        paused_secs: clock.paused_secs,
    };
    storage::set_persistent(e, &Key::TimelockPending(id), &(change.clone(), schedule));
    open.push_back(id);
    storage::set_instance(e, &Key::TimelockOpen, &open);
    storage::set_instance(e, &Key::TimelockNextId, &(id + 1));
    Ok(id)
}

pub fn cancel(e: &Env, id: u32) -> Result<(), Refusal> {
    remove(e, id)
}

/// Removes and returns the change if it may land now.
pub fn take_ready<H: TimelockHost, C>(e: &Env, id: u32) -> Result<C, Refusal>
where
    C: TryFromVal<Env, Val>,
    <C as TryFromVal<Env, Val>>::Error: Debug,
{
    let (change, schedule): (C, Schedule) = pending(e, id).ok_or(Refusal::NotFound)?;
    schedule.check_ready(e.ledger().timestamp(), &H::clock(e)?)?;
    remove(e, id)?;
    Ok(change)
}

fn remove(e: &Env, id: u32) -> Result<(), Refusal> {
    let mut open = open_ids(e);
    let index = open.first_index_of(id).ok_or(Refusal::NotFound)?;
    open.remove(index);
    storage::set_instance(e, &Key::TimelockOpen, &open);
    e.storage().persistent().remove(&Key::TimelockPending(id));
    Ok(())
}
