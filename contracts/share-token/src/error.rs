use soroban_sdk::contracterror;

/// Share token failures. Codes are stable once assigned and are never reused; a
/// removed variant leaves its number retired.
#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum ShareTokenError {
    /// The token must always have an admin: `pause`, `unpause` and role
    /// management need it. Hand it over instead: propose and apply an `Admin`
    /// change (`transfer_admin_role` during setup), then the nominee calls
    /// `accept_admin_transfer`.
    AdminRequired = 7000,
    /// No pending change has this id.
    ChangeNotFound = 7001,
    /// The change's delay has not elapsed.
    ChangeNotReady = 7002,
    /// As many changes as the timelock holds already wait.
    TooManyPendingChanges = 7003,
    /// Changes are instant until setup finishes; there is nothing to propose yet.
    SetupOpen = 7004,
    /// A direct call cannot make this change. After setup it goes through
    /// `propose_change`; setting a role admin is never allowed.
    UseTimelock = 7005,
    /// Only possible while setup is open, and only once.
    SetupClosed = 7006,
    /// Setup cannot finish before the token is bound to its vault.
    VaultNotBound = 7007,
    /// The vault is winding down, so no change may be proposed or applied.
    WindDownActive = 7008,
    /// The vault is paused, which holds every timelocked change.
    VaultPaused = 7009,
    /// The change's delay is shorter than the vault's notice, so an investor
    /// could not complete an exit before it lands.
    DelayBelowNotice = 7010,
    /// An upgrade already waits. Cancel it before proposing another.
    UpgradeAlreadyPending = 7011,
    /// An admin hand-over offered during setup is still open. Setup finishes
    /// once it is accepted, cancelled or expired, so no nominee from setup can
    /// accept after changes start to wait.
    AdminTransferPending = 7016,
}
