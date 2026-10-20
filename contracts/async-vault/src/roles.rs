use soroban_sdk::{contracttype, symbol_short, Address, Symbol};

/// Seals the open epoch. Not the share token's `manager`, which the vault holds.
pub const MANAGER_ROLE: Symbol = symbol_short!("manager");

/// Sends free reserve to the custodian. Anyone may fund the vault back.
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
