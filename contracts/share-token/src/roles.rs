/// Role for allowlist-driven interventions: freeze, forced transfer, recovery.
/// Held by the compliance authority. Minting, burning and escrow use the
/// `manager` role, which governance grants to the vault.
pub const COMPLIANCE_ROLE: &str = "compliance";
