use soroban_sdk::contracterror;

/// Share token failures. Codes are stable once assigned and are never reused; a
/// removed variant leaves its number retired.
#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum ShareTokenError {
    /// The token must always have an admin: `pause`, `unpause` and role
    /// management need it. The admin hands over through `transfer_admin_role`
    /// and `accept_admin_transfer` instead.
    AdminRequired = 7000,
}
