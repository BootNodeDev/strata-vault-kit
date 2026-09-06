use soroban_sdk::{symbol_short, Symbol};

/// Closes an epoch and strikes its share price. Held by the Manager contract.
pub const MANAGER_ROLE: Symbol = symbol_short!("manager");
