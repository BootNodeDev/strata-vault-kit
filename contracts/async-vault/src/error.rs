use soroban_sdk::contracterror;

/// Vault failures. Codes are stable once assigned and are never reused; a
/// removed variant leaves its number retired.
#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum VaultError {
    /// The constructor was given the same address for two authorities that
    /// must be held separately.
    RolesNotDistinct = 6000,
    /// The controller has no request in the given epoch.
    RequestNotFound = 6001,
    /// An amount or share quantity of zero or less was specified.
    InvalidAmount = 6007,
    /// The controller already holds an unclaimed request in this epoch. A
    /// second request is rejected rather than added to the first, so that at
    /// most one request per controller per epoch holds by construction.
    RequestOutstanding = 6009,
    /// The epoch total would exceed `i128::MAX`.
    AmountTooLarge = 6014,
    /// No epoch is stored under the given id.
    EpochNotFound = 6029,
    /// An entry the constructor writes is absent from instance storage, which
    /// means the instance was archived or the contract was never constructed.
    NotInitialized = 6030,
    /// The oracle returned a share price of zero or less. Unreachable with a
    /// correctly configured feed; kept because the oracle sits behind a
    /// settable address.
    InvalidSharePrice = 6031,
    /// The epoch is not `Open`, so it cannot be closed or take new requests.
    EpochNotOpen = 6032,
    /// The epoch is not `Pending`, so it cannot be priced. An
    /// epoch must be closed before it can be fulfilled.
    EpochNotPending = 6038,
    /// The epoch counter would exceed `u64::MAX`.
    EpochOverflow = 6033,
    /// The epoch has not been fulfilled yet, so it has no share price to
    /// claim against.
    EpochNotFulfilled = 6034,
    /// The request was already claimed. Claiming is idempotent by rejection,
    /// not by silently minting nothing twice.
    AlreadyClaimed = 6035,
    /// The vault does not hold enough to pay this claim yet. The liability
    /// stands and the claim succeeds once the reserve covers it.
    ClaimNotCovered = 6037,
    /// The amount would deploy assets already owed to holders whose exit has
    /// been priced but not yet claimed.
    ReserveCommittedToExits = 6005,
    /// No custodian has been set, so capital has nowhere to go.
    CustodianNotSet = 6012,
    /// The epoch is priced, so the request can no longer be cancelled. The
    /// controller claims instead.
    AlreadyPriced = 6039,
    /// The vault must always have an admin. Governance hands over in two steps
    /// rather than stepping down into nobody.
    AdminRequired = 6040,
    /// The epoch is sealed and the feed can price it, so the price it will take
    /// is already knowable. Cancelling now would be declining a price after
    /// seeing it. Fulfil and claim instead.
    PriceAvailable = 6041,
    /// The epoch closed less than its notice ago, so its price is not fixed
    /// yet and every request in it is still waiting.
    NoticeNotElapsed = 6042,
    /// The standing valuation was accepted before the epoch closed. Pricing
    /// against it would use a number the close already outran.
    AttestationBeforeClose = 6043,
    /// The feed is paused or stale, so the epoch has no price to take.
    FeedNotValid = 6044,
    /// The notice exceeds the longest the vault accepts. A notice no investor
    /// could outlive would strand their exit with no way to undo it.
    NoticeTooLong = 6045,
    /// The vault is winding down. Entry, pricing and transfers to the custodian
    /// are closed for the rest of its life.
    WindDownActive = 6046,
    /// No wind-down proposal stands.
    WindDownNotProposed = 6047,
    /// A proposal already stands. Re-proposing would let governance push the
    /// activation date back indefinitely.
    WindDownAlreadyProposed = 6048,
    /// The announcement has not run its delay yet.
    WindDownDelayNotElapsed = 6049,
    /// The wind-down has not been activated, so there is nothing to distribute.
    WindDownNotActive = 6050,
    /// No round has been finalised, so there is no snapshot to claim against.
    DistributionNotStarted = 6051,
    /// The round would distribute nothing, or there is no supply to divide by.
    NothingToDistribute = 6052,
    /// The delay exceeds the longest the vault accepts. A delay nobody could
    /// outlive would mean the vault never closes.
    WindDownDelayTooLong = 6053,
    /// Nothing to surrender and nothing owed. Claiming is idempotent by
    /// rejection, as elsewhere in this contract.
    NoEntitlement = 6054,
    /// A proposal already stands. Replacing one means cancelling it first, so
    /// the standing eta is never quietly moved.
    UpgradeProposalExists = 6055,
    /// No proposal stands.
    UpgradeProposalNotFound = 6056,
    /// The delay has not elapsed.
    UpgradeDelayNotElapsed = 6057,
    /// The delay is below the shortest the vault accepts.
    UpgradeDelayTooShort = 6058,
    /// The delay is shorter than the notice, so an investor could not complete
    /// an exit before the change applies.
    UpgradeDelayBelowNotice = 6059,
    /// The delay exceeds the longest the vault accepts.
    UpgradeDelayTooLong = 6060,
    /// The notice exceeds the upgrade delay, so an investor could not complete
    /// an exit before an upgrade lands.
    NoticeAboveUpgradeDelay = 6061,
}
