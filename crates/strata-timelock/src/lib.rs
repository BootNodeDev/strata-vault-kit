//! # Design
//!
//! A timelock for privileged changes. One contract owns the clock: its delay,
//! its notice (the clock's `exit_window`), its pause time and whether it winds
//! down. That contract and every contract bound to it queue their changes
//! against the same clock.
//!
//! - **One clock, the vault's.** The share token, the oracle and the kit's
//!   compliance contract bind to the vault once, during setup, and read its
//!   clock on every proposal and every apply. One pause and one wind-down then
//!   hold every waiting change in the kit. The cost: while the vault is paused
//!   no contract in the kit can apply a change, and a contract bound to the
//!   wrong vault stays bound.
//! - **A setup window first.** Changes are instant until setup finishes, and
//!   nothing is queued before it; setup closes once and never reopens. The
//!   cost: a mistake found after setup takes a full delay to fix.
//! - **One queue per contract.** Every kind of change waits in the same queue,
//!   at most `MAX_PENDING` at a time, and an id is never handed out twice. The
//!   cost: a full queue refuses proposals until a change lands or is cancelled.
//! - **The delay is an announcement period.** A change keeps the delay it was
//!   proposed with, its eta moves back by every second the vault spends paused,
//!   and nothing lands while the vault is paused. The delay promises notice,
//!   not an exit: leaving before a change lands also needs a sealed epoch, a
//!   price and cash. The cost: a long pause delays every fix.
//! - **Never shorter than the notice.** A change whose delay is shorter than
//!   the notice when it applies never lands. The cost: raising the notice can
//!   strand changes already waiting; they must be proposed again.
//! - **Nothing lands in a wind-down.** Once a wind-down starts nothing is
//!   proposed or applied, and changes already waiting never land. The cost:
//!   nothing can be fixed during a wind-down, a failing compliance module
//!   included.
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
