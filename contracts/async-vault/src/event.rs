use soroban_sdk::{contractevent, Address};

#[contractevent]
pub struct DepositRequested {
    #[topic]
    pub controller: Address,
    pub epoch: u64,
    pub amount: i128,
}
