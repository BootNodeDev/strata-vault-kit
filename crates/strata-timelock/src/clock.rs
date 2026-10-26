use soroban_sdk::{contracttrait, contracttype, Env};

use crate::refusal::Refusal;
use crate::setup;

/// The state of the contract that owns the clock, as every queue on that clock
/// reads it.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Clock {
    /// Seconds a change proposed now waits.
    pub delay: u64,
    /// The longest an exit takes at the source. A change never waits less.
    pub exit_window: u64,
    /// Seconds the source has spent paused, a running pause included.
    pub paused_secs: u64,
    pub paused: bool,
    pub winding_down: bool,
}

/// Implemented by the contract that owns the clock, so the contracts bound to
/// it can read it.
#[contracttrait]
pub trait ClockSource {
    fn timelock_clock(e: &Env) -> Clock;
}

/// Every contract that keeps a change queue implements this. The queue and the
/// setup window read the clock only through it.
pub trait TimelockHost {
    fn clock(e: &Env) -> Result<Clock, Refusal>;
}

/// The clock of the source this contract is bound to. `Err(Refusal::Unbound)`
/// when none is bound.
pub fn from_source(e: &Env) -> Result<Clock, Refusal> {
    let source = setup::source(e).ok_or(Refusal::Unbound)?;
    Ok(ClockSourceClient::new(e, &source).timelock_clock())
}
