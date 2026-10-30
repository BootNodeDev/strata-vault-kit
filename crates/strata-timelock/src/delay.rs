pub const DAY_DURATION: u64 = 24 * 60 * 60;
/// Short enough to fix a defect in a week, long enough to warn holders before
/// a change lands.
pub const MIN_DELAY: u64 = 7 * DAY_DURATION;
/// No delay can wall a contract off from future changes.
pub const MAX_DELAY: u64 = 90 * DAY_DURATION;

pub fn in_bounds(delay: u64) -> bool {
    (MIN_DELAY..=MAX_DELAY).contains(&delay)
}
