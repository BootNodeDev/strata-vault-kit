/// Why the timelock refused. Each contract maps these onto its own error
/// codes, so its codes stay stable.
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
pub enum Refusal {
    /// The contract that owns the clock is winding down: nothing is proposed
    /// or applied.
    WindingDown,
    Paused,
    /// The change's delay, plus the time paused since, has not run yet.
    NotElapsed,
    /// The change's delay is shorter than the current exit window.
    BelowExitWindow,
    /// No pending change has this id.
    NotFound,
    /// `MAX_PENDING` changes already wait.
    TooMany,
    /// Changes are instant until setup finishes, so none is queued before.
    SetupOpen,
    SetupClosed,
    /// No clock source is bound.
    Unbound,
    AlreadyBound,
}
