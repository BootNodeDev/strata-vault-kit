use soroban_sdk::contracttype;

use crate::clock::Clock;
use crate::refusal::Refusal;

/// When a change was proposed, and the clock it started from.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Schedule {
    pub proposed_at: u64,
    pub delay: u64,
    pub paused_secs: u64,
}

impl Schedule {
    /// The moment the change may land, pushed back by every second the source
    /// has spent paused since it was proposed.
    pub fn eta(&self, clock: &Clock) -> u64 {
        self.proposed_at
            .saturating_add(self.delay)
            .saturating_add(clock.paused_secs.saturating_sub(self.paused_secs))
    }

    pub fn check_ready(&self, now: u64, clock: &Clock) -> Result<(), Refusal> {
        if clock.winding_down {
            return Err(Refusal::WindingDown);
        }
        if clock.paused {
            return Err(Refusal::Paused);
        }
        if self.delay < clock.exit_window {
            return Err(Refusal::BelowExitWindow);
        }
        if now < self.eta(clock) {
            return Err(Refusal::NotElapsed);
        }
        Ok(())
    }
}
