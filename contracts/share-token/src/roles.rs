use soroban_sdk::{symbol_short, Symbol};

/// Operator role for privileged token actions. Held by the vault.
pub const MANAGER_ROLE: Symbol = symbol_short!("manager");
