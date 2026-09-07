use soroban_sdk::{contractevent, Address};

#[contractevent]
pub struct DepositRequested {
    #[topic]
    pub controller: Address,
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
    pub controller: Address,
    pub epoch: u64,
    pub amount: i128,
    pub shares: i128,
}
