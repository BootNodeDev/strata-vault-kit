use soroban_sdk::{contracttype, Address};

#[contracttype]
pub(crate) enum DataKey {
    Asset,
    ShareToken,
    Manager,
    Oracle,
    Custodian,
    NetDeployed,
    CurrentEpoch,
    PendingRedeemAssets,
    PendingMintShares,
    Epoch(u64),
    UserDeposit(u64, Address),
    UserRedeem(u64, Address),
}
