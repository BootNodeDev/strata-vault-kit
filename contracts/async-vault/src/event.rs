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

#[contractevent]
pub struct RedeemRequested {
    #[topic]
    pub controller: Address,
    pub epoch: u64,
    pub shares: i128,
}

#[contractevent]
pub struct RedeemClaimed {
    #[topic]
    pub controller: Address,
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
pub struct Deployed {
    #[topic]
    pub custodian: Address,
    pub assets: i128,
    pub net_deployed: i128,
}

#[contractevent]
pub struct Funded {
    #[topic]
    pub from: Address,
    pub assets: i128,
    pub net_deployed: i128,
}
