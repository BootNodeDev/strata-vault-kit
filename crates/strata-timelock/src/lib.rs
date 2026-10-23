//! A timelock for privileged changes. One contract owns the clock: its delay,
//! its exit window, its pause time and whether it winds down. That contract and
//! every contract bound to it queue their changes against the same clock.

#![no_std]

pub mod clock;
pub mod delay;
mod keys;
pub mod pause;
pub mod queue;
pub mod refusal;
pub mod schedule;
pub mod setup;

pub use clock::{Clock, ClockSource, ClockSourceClient, TimelockHost};
pub use delay::{DAY_DURATION, MAX_DELAY, MIN_DELAY};
pub use queue::MAX_PENDING;
pub use refusal::Refusal;
pub use schedule::Schedule;

#[cfg(test)]
mod test;
