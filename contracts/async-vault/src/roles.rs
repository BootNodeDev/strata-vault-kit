use soroban_sdk::{contracttype, symbol_short, Address, Symbol};

/// Closes an epoch and sets its share price. Held by the Manager contract.
pub const MANAGER_ROLE: Symbol = symbol_short!("manager");

/// Moves capital to the custodian and funds the vault back.
pub const TREASURY_ROLE: Symbol = symbol_short!("treasury");

pub const GUARDIAN_ROLE: Symbol = symbol_short!("guardian");

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct VaultRoles {
    pub governance: Address,
    pub manager: Address,
    pub treasury: Address,
    pub guardian: Address,
    pub compliance: Address,
    pub attester: Address,
}
