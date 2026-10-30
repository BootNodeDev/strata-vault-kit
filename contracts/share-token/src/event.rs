use soroban_sdk::{contractevent, Address, String};

use crate::governance::TokenChange;

#[contractevent]
pub struct ChangeProposed {
    #[topic]
    pub id: u32,
    pub change: TokenChange,
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
    pub change: TokenChange,
}

#[contractevent]
pub struct SetupFinished {}

#[contractevent]
pub struct VaultBound {
    #[topic]
    pub vault: Address,
}

#[contractevent]
pub struct LegalTransfer {
    #[topic]
    pub from: Address,
    #[topic]
    pub to: Address,
    pub amount: i128,
    pub reference: String,
}
