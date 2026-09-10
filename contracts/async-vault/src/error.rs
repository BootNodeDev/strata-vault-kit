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
    /// The deposit is smaller than one share at the epoch's price, so it would
    /// mint zero. Rejected rather than burning the deposit to dust.
    NothingToClaim = 6036,
    /// The vault does not hold enough to pay this claim yet. The liability
    /// stands and the claim succeeds once the reserve covers it.
    ClaimNotCovered = 6037,
    /// The amount would deploy assets already owed to holders whose exit has
    /// been priced but not yet claimed.
    ReserveCommittedToExits = 6005,
    /// No custodian has been set, so capital has nowhere to go.
    CustodianNotSet = 6012,
    /// The epoch is priced, so the request can no longer be recalled. The
    /// controller claims instead.
    AlreadyPriced = 6039,
}
