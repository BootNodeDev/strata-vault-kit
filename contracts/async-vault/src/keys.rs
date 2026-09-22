use soroban_sdk::{contracttype, Address};

#[contracttype]
pub(crate) enum DataKey {
    Asset,
    ShareToken,
    Oracle,
    Custodian,
    NetDeployed,
    CurrentEpoch,
    Notice,
    Committed,
    CancellableEscrow,
    PendingMintShares,
    PendingBurnShares,
    Epoch(u64),
    UserDeposit(u64, Address),
    UserRedeem(u64, Address),
    UpgradeDelay,
    UpgradeProposal,
    PausedAt,
    WindDownDelay,
    WindDown,
    WindDownSupply,
    WindDownAcc,
    WindDownOwed,
    WindDownPosition(Address),
}
