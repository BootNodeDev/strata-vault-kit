use soroban_sdk::contracterror;

strata_bindings::error_enum! {
    strata_bindings::VAULT_ERRORS,

    /// Vault failures, coded 6000 to 6999. Codes are stable once assigned and
    /// are never reused; a removed variant leaves its number retired.
    #[contracterror]
    #[derive(Copy, Clone, Debug, Eq, PartialEq)]
    #[repr(u32)]
    pub enum VaultError {
        /// The constructor was given the same address for two authorities that
        /// must be held separately.
        RolesNotDistinct = 6000,
        /// The holder has no request in the given epoch.
        RequestNotFound = 6001,
        /// An amount or share quantity of zero or less was specified, a
        /// negative deposit cap, or a minimum epoch duration outside 1 to 30
        /// days.
        InvalidAmount = 6007,
        /// The holder already has an unclaimed request in this epoch. A
        /// second request is rejected rather than added to the first, so that at
        /// most one request per holder per epoch holds by construction.
        RequestOutstanding = 6009,
        /// A sum, count or conversion would not fit its type: a running total or
        /// a conversion of assets or shares past `i128`, or an epoch's count of
        /// open requests past `u32`.
        AmountTooLarge = 6014,
        /// No epoch is stored under the given id.
        EpochNotFound = 6029,
        /// An entry the constructor writes is missing from instance storage. A
        /// constructed vault always has it.
        NotInitialized = 6030,
        /// The oracle returned a share price of zero or less. Unreachable with a
        /// correctly configured feed; kept because the oracle sits behind a
        /// settable address.
        InvalidSharePrice = 6031,
        /// The epoch is not `Open`, so it cannot be closed or take new requests.
        EpochNotOpen = 6032,
        /// The epoch is not `Pending`, so it cannot be priced. An
        /// epoch must be closed before it can be fulfilled.
        EpochNotPending = 6038,
        /// The epoch counter would exceed `u64::MAX`.
        EpochOverflow = 6033,
        /// The epoch has not been fulfilled yet, so it has no share price to
        /// claim against.
        EpochNotFulfilled = 6034,
        /// The request was already claimed. Claiming is idempotent by rejection,
        /// not by silently minting nothing twice.
        AlreadyClaimed = 6035,
        /// The vault does not hold enough to pay this claim yet. The liability
        /// stands and the claim succeeds once the reserve covers it.
        ClaimNotCovered = 6037,
        /// The amount would deploy assets that are not free: escrow depositors
        /// can still cancel, or cash owed to holders whose exit has been priced
        /// but not yet claimed.
        ReserveCommittedToExits = 6005,
        /// No custodian has been set, so capital has nowhere to go.
        CustodianNotSet = 6012,
        /// The epoch is priced, so the request can no longer be cancelled. The
        /// holder claims instead.
        AlreadyPriced = 6039,
        /// The call needs the admin. `unpause` refuses any other caller.
        /// `renounce_admin` is always refused, because the vault must always have
        /// an admin: governance hands over in two steps rather than stepping down
        /// into nobody.
        AdminRequired = 6040,
        /// The epoch is sealed and the feed can price it, so the price it will take
        /// is already knowable. Cancelling now would be declining a price after
        /// seeing it. Fulfil and claim instead.
        PriceAvailable = 6041,
        /// The epoch closed less than its notice ago, so its price is not fixed
        /// yet and every request in it is still waiting.
        NoticeNotElapsed = 6042,
        /// The standing valuation was accepted before the epoch closed. Pricing
        /// against it would use a number the close already outran.
        AttestationBeforeClose = 6043,
        /// The feed is paused or stale, so no epoch can be priced from it and no
        /// deposit is taken.
        FeedNotValid = 6044,
        /// The notice exceeds the longest the vault accepts. A notice no investor
        /// could outlive would strand their exit with no way to undo it.
        NoticeTooLong = 6045,
        /// The vault is winding down. New requests, epoch closes, pricing,
        /// transfers to the custodian, wind-down proposals, admin hand-overs
        /// and timelocked changes are closed for the rest of its life.
        WindDownActive = 6046,
        /// No wind-down proposal stands.
        WindDownNotProposed = 6047,
        /// A proposal already stands. Re-proposing would let governance push the
        /// activation date back indefinitely. While it stands, the vault takes
        /// no new deposit.
        WindDownAlreadyProposed = 6048,
        /// The announcement has not run its delay yet.
        WindDownDelayNotElapsed = 6049,
        /// The wind-down has not been activated, so there is nothing to distribute.
        WindDownNotActive = 6050,
        /// No round has been finalised, so there is no snapshot to claim against.
        DistributionNotStarted = 6051,
        /// The round would distribute nothing, or there is no supply to divide by.
        NothingToDistribute = 6052,
        /// The delay exceeds the longest the vault accepts. A delay nobody could
        /// outlive would mean the vault never closes.
        WindDownDelayTooLong = 6053,
        /// Nothing to surrender and nothing owed, or the holder is the vault,
        /// whose shares are other holders' escrow. Claiming is idempotent by
        /// rejection, as elsewhere in this contract.
        NoEntitlement = 6054,
        /// A code change already waits. Replacing one means cancelling it first, so
        /// the standing eta is never quietly moved.
        UpgradeProposalExists = 6055,
        /// No pending change has this id.
        ChangeNotFound = 6056,
        /// The change's delay has not elapsed.
        ChangeNotReady = 6057,
        /// The delay is below the shortest the vault accepts.
        UpgradeDelayTooShort = 6058,
        /// The delay is shorter than the notice, so an investor could not complete
        /// an exit before the change applies. Checked when a change is proposed and
        /// again when it applies, since the notice may have risen in between.
        UpgradeDelayBelowNotice = 6059,
        /// The delay exceeds the longest the vault accepts.
        UpgradeDelayTooLong = 6060,
        /// The notice exceeds the upgrade delay, so an investor could not complete
        /// an exit before an upgrade lands.
        NoticeAboveUpgradeDelay = 6061,
        /// A deposit request would breach the vault's configured deposit cap.
        DepositCapExceeded = 6062,
        /// As many changes as the timelock holds already wait. Apply or cancel one
        /// first.
        TooManyPendingChanges = 6063,
        /// Setup is still open, so the timelock protects nothing yet: the vault
        /// takes no request, seals or prices no epoch, and queues no change.
        /// Governance finishes setup first.
        SetupOpen = 6064,
        /// A direct call cannot make this change. After setup it goes through
        /// `propose_change`; setting a role admin is never allowed.
        UseTimelock = 6065,
        /// Setup has finished, and it never reopens.
        SetupClosed = 6066,
        /// A wiring check `health()` reports is false (token, oracle and compliance
        /// bound, sole token manager, allowlisted, not frozen, matching decimals,
        /// distinct addresses, a feed that answers, a custodian) or the token has
        /// shares outstanding, or the vault's own books are not empty, so setup
        /// cannot finish.
        SetupIncomplete = 6067,
        /// The holder fails the share token's identity check, so the vault takes no
        /// deposit request from them and returns no escrowed shares to them. A
        /// verifier that cannot answer, such as a broken or archived one, counts
        /// as a failed check.
        NotAllowlisted = 6068,
        /// The wind-down delay is below the shortest the vault accepts.
        WindDownDelayTooShort = 6069,
        /// A running total would go below zero, or the deposited capital the cap
        /// is checked against would go below `i128::MIN`. Either means the vault's
        /// books disagree with themselves; it fails loudly instead of clamping.
        AccountingMismatch = 6070,
        /// The holder is frozen. What the vault owes them is held, not paid,
        /// returned or moved, until compliance lifts the freeze. A partial freeze
        /// refuses only what would touch frozen shares.
        Frozen = 6071,
        /// The proposed feed does not name this vault as its own, its setup is
        /// still open, or it does not answer `state()` and `freshness_duration()`.
        /// Its admin could then change its limits with no delay, or no epoch could
        /// be priced from it.
        FeedNotBound = 6072,
        /// The holder may not receive shares (delisted, frozen or refused by the
        /// compliance rules), so the escrowed shares stay with the vault and the
        /// request stays open.
        HolderNotEligible = 6073,
        /// An admin hand-over offered during setup is still open. Setup finishes
        /// once it is accepted, cancelled or expired, so no nominee from setup can
        /// accept after changes start to wait.
        AdminTransferPending = 6074,
        /// The custodian would be the vault itself. Capital deployed to it would
        /// never leave, and the books would count it as both held and deployed.
        InvalidCustodian = 6075,
        /// The vault holds less than the escrow depositors can still cancel,
        /// because the asset's issuer took part of its balance. A cancellation
        /// the balance cannot cover waits, and no new deposit is taken, until the
        /// vault is funded.
        EscrowNotCovered = 6076,
        /// The caller lacks `manager` and the open epoch has been open less than
        /// the minimum epoch duration, or has no recorded start yet (setup is
        /// still open).
        MinEpochDurationNotElapsed = 6077,
    }
}
