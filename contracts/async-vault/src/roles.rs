use soroban_sdk::{symbol_short, Symbol};

/// Closes an epoch and sets its share price. Held by the Manager contract.
pub const MANAGER_ROLE: Symbol = symbol_short!("manager");

/// Moves capital to the custodian and funds the vault back.
pub const TREASURY_ROLE: Symbol = symbol_short!("treasury");
