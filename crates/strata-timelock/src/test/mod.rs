extern crate std;

mod clock;
mod delay;
mod pause;
mod queue;
mod schedule;
mod setup;
mod storage_keys;

use soroban_sdk::{contract, contractimpl, contracttype, testutils::Ledger as _, Address, Env};

use crate::{Clock, ClockSource, Refusal, TimelockHost, MIN_DELAY};

#[contracttype]
enum TestKey {
    Clock,
}

/// Owns its clock. A test sets the clock it reports.
#[contract]
struct Owner;

impl TimelockHost for Owner {
    fn clock(e: &Env) -> Result<Clock, Refusal> {
        Ok(e.storage()
            .instance()
            .get(&TestKey::Clock)
            .unwrap_or_else(|| clock(MIN_DELAY)))
    }
}

#[contractimpl(contracttrait)]
impl ClockSource for Owner {
    fn timelock_clock(e: &Env) -> Clock {
        <Owner as TimelockHost>::clock(e).unwrap()
    }
}

/// Reads its clock from the source it is bound to.
#[contract]
struct Follower;

impl TimelockHost for Follower {
    fn clock(e: &Env) -> Result<Clock, Refusal> {
        crate::clock::from_source(e)
    }
}

#[contractimpl]
impl Follower {
    pub fn bind(e: Env, source: Address) {
        crate::setup::bind_source(&e, &source).unwrap();
    }
}

fn clock(delay: u64) -> Clock {
    Clock {
        delay,
        exit_window: 0,
        paused_secs: 0,
        paused: false,
        winding_down: false,
    }
}

/// Makes the owner report this clock. Runs inside the owner's frame.
fn set_clock(e: &Env, clock: &Clock) {
    e.storage().instance().set(&TestKey::Clock, clock);
}

/// An owner at ledger time 1_000, its setup window still open.
fn owner() -> (Env, Address) {
    let e = Env::default();
    e.ledger().set_timestamp(1_000);
    let id = e.register(Owner, ());
    (e, id)
}

/// An owner past setup, so its queue takes changes.
fn ready_owner() -> (Env, Address) {
    let (e, id) = owner();
    e.as_contract(&id, || crate::setup::finish::<Owner>(&e).unwrap());
    (e, id)
}
