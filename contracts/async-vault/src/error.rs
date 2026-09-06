use soroban_sdk::contracterror;

/// Vault failures. Codes are stable once assigned and are never reused; a
/// removed variant leaves its number retired.
#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum VaultError {
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
    /// `fulfill_epoch` was called with a share price of zero or less.
    InvalidSharePrice = 6031,
    /// The epoch has already been fulfilled and can no longer be struck.
    EpochNotOpen = 6032,
    /// The epoch counter would exceed `u64::MAX`.
    EpochOverflow = 6033,
}
