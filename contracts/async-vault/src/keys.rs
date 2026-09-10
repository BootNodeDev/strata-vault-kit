use soroban_sdk::{contracttype, Address};

#[contracttype]
pub(crate) enum DataKey {
    Asset,
    ShareToken,
    Oracle,
    Custodian,
    NetDeployed,
    CurrentEpoch,
    Committed,
    CancellableEscrow,
    PendingMintShares,
    Epoch(u64),
    UserDeposit(u64, Address),
    UserRedeem(u64, Address),
}
