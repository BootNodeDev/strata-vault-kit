use soroban_sdk::{symbol_short, Symbol};

/// Role for allowlist-driven interventions: freeze, forced transfer, recovery.
/// Held by the compliance authority. Minting, burning and escrow use the
/// `manager` role, which governance grants to the vault.
pub const COMPLIANCE_ROLE: &str = "compliance";

/// The vault's role. Without it the vault cannot mint or burn, so no claim pays.
pub const MANAGER_ROLE: Symbol = symbol_short!("manager");
