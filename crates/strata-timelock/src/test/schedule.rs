use proptest::prelude::*;

use super::*;
use crate::{Schedule, DAY_DURATION, MAX_DELAY};

#[test]
fn time_spent_paused_does_not_count_toward_the_delay() {
    let schedule = Schedule {
        proposed_at: 1_000,
        delay: MIN_DELAY,
        paused_secs: 50,
    };
    let mut c = clock(MIN_DELAY);
    c.paused_secs = 50 + 3 * DAY_DURATION;

    assert_eq!(schedule.eta(&c), 1_000 + MIN_DELAY + 3 * DAY_DURATION);
    assert_eq!(
        schedule.check_ready(1_000 + MIN_DELAY, &c),
        Err(Refusal::NotElapsed)
    );
    assert_eq!(
        schedule.check_ready(1_000 + MIN_DELAY + 3 * DAY_DURATION, &c),
        Ok(())
    );
}

#[test]
fn nothing_lands_while_paused_or_winding_down() {
    let schedule = Schedule {
        proposed_at: 0,
        delay: MIN_DELAY,
        paused_secs: 0,
    };
    let mut paused = clock(MIN_DELAY);
    paused.paused = true;
    let mut winding = clock(MIN_DELAY);
    winding.winding_down = true;
    let mut both = paused.clone();
    both.winding_down = true;

    assert_eq!(
        schedule.check_ready(MAX_DELAY, &paused),
        Err(Refusal::Paused)
    );
    assert_eq!(
        schedule.check_ready(MAX_DELAY, &winding),
        Err(Refusal::WindingDown)
    );
    assert_eq!(
        schedule.check_ready(MAX_DELAY, &both),
        Err(Refusal::WindingDown)
    );
}

#[test]
fn a_change_shorter_than_the_current_exit_window_never_lands() {
    let schedule = Schedule {
        proposed_at: 0,
        delay: MIN_DELAY,
        paused_secs: 0,
    };
    let mut c = clock(MIN_DELAY);
    c.exit_window = MIN_DELAY + 1;

    assert_eq!(schedule.check_ready(0, &c), Err(Refusal::BelowExitWindow));
    assert_eq!(
        schedule.check_ready(MAX_DELAY, &c),
        Err(Refusal::BelowExitWindow)
    );
}

proptest! {
    #[test]
    fn the_eta_never_comes_before_proposal_plus_delay(
        proposed_at in 0u64..1_000_000_000,
        delay in MIN_DELAY..=MAX_DELAY,
        paused_before in 0u64..1_000_000,
        paused_since in 0u64..1_000_000,
    ) {
        let schedule = Schedule { proposed_at, delay, paused_secs: paused_before };
        let mut c = clock(delay);
        c.paused_secs = paused_before + paused_since;
        let at = schedule.eta(&c);
        prop_assert_eq!(at, proposed_at + delay + paused_since);
        prop_assert!(schedule.check_ready(at - 1, &c).is_err());
        prop_assert!(schedule.check_ready(at, &c).is_ok());
    }
}
