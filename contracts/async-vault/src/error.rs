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
    /// most one request per controller per side holds by construction.
    RequestOutstanding = 6009,
    /// The epoch total would exceed `i128::MAX`.
    AmountTooLarge = 6014,
    /// No epoch is stored under the given id.
    EpochNotFound = 6029,
    /// An address the constructor writes is absent from instance storage,
    /// which means the entry was archived or the contract was never
    /// constructed.
    AddressNotSet = 6030,
}
