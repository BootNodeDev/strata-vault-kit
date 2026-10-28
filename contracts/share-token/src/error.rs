use soroban_sdk::contracterror;

strata_bindings::error_enum! {
    strata_bindings::TOKEN_ERRORS,

    /// Share token failures, coded 7000 to 7999. Codes are stable once assigned
    /// and are never reused; a removed variant leaves its number retired.
    #[contracterror]
    #[derive(Copy, Clone, Debug, Eq, PartialEq)]
    #[repr(u32)]
    pub enum ShareTokenError {
        /// The call needs the admin. `pause`, `unpause`, `set_compliance` and
        /// `set_identity_verifier` refuse any other caller. `renounce_admin` is
        /// always refused, because the token must always have an admin: hand it
        /// over instead by proposing and applying an `Admin` change
        /// (`transfer_admin_role` during setup), then the nominee calls
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
        /// The vault is winding down, and the change is not a grant of
        /// `compliance`. No admin hand-over is accepted then either.
        WindDownActive = 7008,
        /// The vault is paused, which holds every timelocked change.
        VaultPaused = 7009,
        /// The change's delay is shorter than the vault's notice, so an investor
        /// could not complete an exit before it lands.
        DelayBelowNotice = 7010,
        /// An upgrade already waits. Cancel it before proposing another.
        UpgradeAlreadyPending = 7011,
        /// The vault's own address cannot be frozen, and no transfer, legal
        /// transfer or recovery moves shares into it or out of it: its balance
        /// is other investors' escrow.
        VaultAddress = 7012,
        /// A legal transfer or a recovery needs the compliance authority and the
        /// admin as two different accounts, so no single key moves value.
        CoSignRequired = 7013,
        /// A legal transfer names the order behind it: a reference of 1 to 128
        /// bytes.
        InvalidReference = 7015,
        /// An admin hand-over offered during setup is still open. Setup finishes
        /// once it is accepted, cancelled or expired, so no nominee from setup can
        /// accept after changes start to wait.
        AdminTransferPending = 7016,
        /// The proposed compliance contract's `linked_tokens` leaves out this
        /// token, so every mint, transfer and burn would fail. Or it answers
        /// `vault()` and `setup_open()` but does not name this token's vault
        /// with its setup closed, so its rules could change without the
        /// vault's delay. One that leaves either view unanswered is an
        /// external module and passes, on trust.
        ComplianceNotBound = 7017,
        /// The proposed identity verifier refuses the vault's address or does
        /// not answer `verify_identity`. The vault needs that check to convert
        /// a delisted holder's deposit, and a verifier that cannot answer makes
        /// every holder look delisted.
        VerifierRefusesVault = 7018,
        /// The caller is the token's only `compliance` holder. Lifting a
        /// freeze needs the role, so it cannot be given up; grant a successor
        /// first. The admin can still revoke it.
        LastComplianceHolder = 7019,
    }
}
