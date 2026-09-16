/// When a closed epoch may be priced. A deployment that wants a different
/// schedule implements this; property tests hold every implementation to the
/// same laws.
pub(crate) trait FulfilmentTiming {
    /// The moment an epoch becomes priceable. Read once, when the epoch
    /// closes, so a later change to the notice cannot move it.
    fn priceable_at(closed_at: u64, notice: u64) -> u64;

    fn notice_elapsed(now: u64, priceable_at: u64) -> bool;

    fn price_is_current(closed_at: u64, attested_at: u64) -> bool;
}

/// The notice runs from the close, and the valuation must be no older than it.
pub(crate) struct StandardTiming;

impl FulfilmentTiming for StandardTiming {
    fn priceable_at(closed_at: u64, notice: u64) -> u64 {
        closed_at.saturating_add(notice)
    }

    fn notice_elapsed(now: u64, priceable_at: u64) -> bool {
        now >= priceable_at
    }

    fn price_is_current(closed_at: u64, attested_at: u64) -> bool {
        attested_at >= closed_at
    }
}
