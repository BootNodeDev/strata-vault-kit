use soroban_sdk::{contractevent, Address};

use crate::governance::VaultChange;

#[contractevent]
pub struct DepositRequested {
    #[topic]
    pub holder: Address,
    pub epoch: u64,
    pub amount: i128,
}

#[contractevent]
pub struct EpochFulfilled {
    #[topic]
    pub epoch: u64,
    pub share_price: i128,
    pub total_deposited: i128,
}

#[contractevent]
pub struct DepositClaimed {
    #[topic]
    pub holder: Address,
    pub epoch: u64,
    pub amount: i128,
    pub shares: i128,
}

#[contractevent]
pub struct RedeemRequested {
    #[topic]
    pub holder: Address,
    pub epoch: u64,
    pub shares: i128,
}

#[contractevent]
pub struct RedeemClaimed {
    #[topic]
    pub holder: Address,
    pub epoch: u64,
    pub shares: i128,
    pub assets: i128,
}

#[contractevent]
pub struct EpochClosed {
    #[topic]
    pub epoch: u64,
    pub total_deposited: i128,
    pub total_shares_redeeming: i128,
}

#[contractevent]
pub struct CustodianSet {
    #[topic]
    pub custodian: Address,
}

#[contractevent]
pub struct NoticeSet {
    pub secs: u64,
}

#[contractevent]
pub struct Deployed {
    #[topic]
    pub custodian: Address,
    pub assets: i128,
    pub net_deployed: i128,
}

#[contractevent]
pub struct Funded {
    #[topic]
    pub caller: Address,
    pub assets: i128,
    pub net_deployed: i128,
}

#[contractevent]
pub struct DepositCancelled {
    #[topic]
    pub holder: Address,
    pub epoch: u64,
    pub amount: i128,
}

#[contractevent]
pub struct RedeemCancelled {
    #[topic]
    pub holder: Address,
    pub epoch: u64,
    pub shares: i128,
}

#[contractevent]
pub struct ChangeProposed {
    #[topic]
    pub id: u32,
    pub change: VaultChange,
    pub eta: u64,
}

#[contractevent]
pub struct ChangeCancelled {
    #[topic]
    pub id: u32,
}

#[contractevent]
pub struct ChangeApplied {
    #[topic]
    pub id: u32,
    pub change: VaultChange,
}

#[contractevent]
pub struct SetupFinished {}

#[contractevent]
pub struct WindDownDelaySet {
    pub secs: u64,
}

#[contractevent]
pub struct WindDownProposed {
    pub active_at: u64,
}

#[contractevent]
pub struct WindDownProposalCancelled {}

#[contractevent]
pub struct WindDownActivated {}

#[contractevent]
pub struct WindDownRoundFinalized {
    #[topic]
    pub round: u32,
    pub pot: i128,
    pub credited: i128,
    pub acc_per_share: i128,
}

#[contractevent]
pub struct WindDownClaimed {
    #[topic]
    pub holder: Address,
    pub surrendered: i128,
    pub assets: i128,
}

/// An escrowed redemption burned into the holder's wind-down entitlement.
#[contractevent]
pub struct RedemptionSurrendered {
    #[topic]
    pub holder: Address,
    pub epoch: u64,
    pub shares: i128,
}

/// A priced deposit queued to exit in `into_epoch`; zero means the wind-down entitlement.
#[contractevent]
pub struct DepositConvertedToExit {
    #[topic]
    pub holder: Address,
    pub epoch: u64,
    pub into_epoch: u64,
    pub shares: i128,
}

#[contractevent]
pub struct EpochReconciled {
    #[topic]
    pub epoch: u64,
    pub share_dust: i128,
    pub cash_dust: i128,
}

#[contractevent]
pub struct DepositCapUpdated {
    pub old_cap: Option<i128>,
    pub new_cap: Option<i128>,
}

#[contractevent]
pub struct MinEpochDurationSet {
    pub secs: u64,
}
