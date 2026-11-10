use crate::delay::in_bounds;
use crate::DAY_DURATION;

#[test]
fn a_delay_from_seven_to_ninety_days_is_in_bounds() {
    assert!(!in_bounds(7 * DAY_DURATION - 1));
    assert!(in_bounds(7 * DAY_DURATION));
    assert!(in_bounds(90 * DAY_DURATION));
    assert!(!in_bounds(90 * DAY_DURATION + 1));
}
