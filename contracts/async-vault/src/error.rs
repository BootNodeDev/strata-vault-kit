use soroban_sdk::contracterror;

/// Vault failures. Codes are stable once assigned and are never reused; a
/// removed variant leaves its number retired.
#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum VaultError {
    /// The controller has no deposit request in the given epoch.
    RequestNotFound = 6001,
    /// `request_deposit` was called with an amount of zero or less.
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
    /// The epoch is not `Pending`, so no price may be struck against it. An
    /// epoch must be closed before it can be fulfilled.
    EpochNotPending = 6038,
    /// The epoch counter would exceed `u64::MAX`.
    EpochOverflow = 6033,
    /// The epoch has not been struck yet, so no share price exists to claim
    /// against.
    EpochNotFulfilled = 6034,
    /// The request was already claimed. Claiming is idempotent by rejection,
    /// not by silently minting nothing twice.
    AlreadyClaimed = 6035,
    /// The deposit is smaller than one share at the struck price, so it would
    /// mint zero. Rejected rather than burning the deposit to dust.
    NothingToClaim = 6036,
    /// The vault does not hold enough assets to settle the epoch's redemptions
    /// at the attested price, so the epoch is not struck at all.
    InsufficientLiquidity = 6037,
}
