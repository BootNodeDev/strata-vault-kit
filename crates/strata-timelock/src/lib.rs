//! # Design
//!
//! A timelock for privileged changes. One contract owns the clock: its delay,
//! its notice (the clock's `exit_window`), its pause time and whether it winds
//! down. That contract and every contract bound to it queue their changes
//! against the same clock.
//!
//! - **One clock, the vault's.** The token, the oracle and the compliance
//!   contract bind to it once, during setup, and read it on every proposal and
//!   apply. The cost: a vault pause holds every change in the kit.
//! - **A setup window first.** Changes are instant until setup ends, nothing
//!   queues before it, and it never reopens. The cost: a mistake found after
//!   setup takes a full delay to fix.
//! - **One queue per contract.** Every kind of change shares it, at most
//!   `MAX_PENDING` at once, and no id is reused. The cost: a full queue refuses
//!   proposals until a change lands or is cancelled.
//! - **The delay is an announcement period.** It promises notice, not an exit,
//!   which also needs a sealed epoch, a price and cash. Paused time does not
//!   count. The cost: a long pause delays every fix.
//! - **Never shorter than the notice.** Each attempt to apply compares the
//!   change's delay with the notice then. The cost: a raised notice holds back
//!   waiting changes until it comes down or they are proposed again.
//! - **Nothing lands in a wind-down.** Nothing is proposed or applied once it
//!   starts. The cost: nothing can be fixed during a wind-down, a failing
//!   compliance module included. A host may ignore the flag for a change it
//!   must let through; the share token does for a `compliance` grant, which
//!   still waits the delay.
//! - **Seven to ninety days.** `MIN_DELAY` and `MAX_DELAY` bound the delay the
//!   vault sets. The cost: the fastest fix after setup takes a week.

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
