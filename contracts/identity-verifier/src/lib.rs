//! # Design
//!
//! - **Three answers.** An account is verified, refused with OpenZeppelin's
//!   `IdentityVerificationFailed` (304) or `IdentityNotFound` (321), or met
//!   with `Unavailable` when a contract the answer depends on fails. The vault
//!   converts a priced deposit on a refusal and holds it open on a fault. The
//!   cost: a broken issuer holds deposits until it is fixed or removed.
//! - **Only the kit issuer's refusals are a no.** An issuer's contract error
//!   in `ISSUER_REFUSALS` is its no. Anything else, including the host's one
//!   error for a trap, a missing contract or a signature that fails, is a
//!   fault. The cost: a stored claim whose signature fails reads as a fault.
//! - **A definite no wins.** A topic refuses when it has trusted issuers and
//!   each says no, and a refusing topic refuses the account whatever the
//!   others say. A topic with a failing issuer and no yes is a fault. The
//!   cost: the check reads on after a fault, so it costs more.
//! - **Only the claims governance chose are read.** For each required topic
//!   and trusted issuer, the verifier reads the one claim id OpenZeppelin
//!   gives that pair, never the identity's index, so an investor cannot add
//!   claims that push its check over budget. The cost: a claim stored under
//!   another id is not seen.
//! - **Fails closed, as a fault.** With no required topic, or a required
//!   topic with no trusted issuer, nobody can answer, so the verifier fails
//!   with `Unavailable` and lets no one in, unlike OpenZeppelin's default. It
//!   is not a refusal, so a governance mistake holds priced deposits instead of
//!   converting them. The cost: a fund requires at least one topic, each with
//!   an issuer, before anyone holds shares.
//! - **Protocol addresses pass unread.** The bound vault always passes and
//!   cannot be removed; governance may name others. The cost: a protocol
//!   address holds and moves shares with no identity.
//! - **Onboarding asks the same question.** `check_claims` runs the topic
//!   check on an identity and never calls the registry, which is mid-call
//!   when it asks. The cost: a registry wired to another verifier checks
//!   other rules, which `ready_for` reports.
//! - **Changes wait for the vault's timelock.** After setup, protocol
//!   addresses, the registry, the topics contract and the admin change only
//!   through it, and a wind-down refuses all but removing a protocol address.
//!   The cost: a broken registry stays for the rest of a wind-down, where the
//!   vault treats a fault like a refusal.
//! - **No recovery and no upgrade.** `recovery_target` is always `None`. The
//!   cost: a fix means a new verifier, swapped in on the token through the
//!   timelock.

#![no_std]

mod governance;
mod guards;
mod protocol;
mod readiness;
mod verification;

use soroban_sdk::{contract, contracterror, contractevent, contractimpl, Address, Env, Vec};
use stellar_access::access_control;
use stellar_macros::only_admin;
use stellar_tokens::rwa::identity_verification::{self, storage};
use strata_bindings::{ClaimsCheck, VaultBinding, VerifierSetup};

pub use governance::{VerifierChange, VerifierPendingChange, ADMIN_ACCEPT_LEDGERS};

strata_bindings::error_enum! {
    strata_bindings::IDENTITY_ERRORS,

    /// Identity verifier failures, coded 10000 to 10199. Codes are stable once
    /// assigned and are never reused; a removed variant leaves its number
    /// retired.
    #[contracterror]
    #[derive(Copy, Clone, Debug, Eq, PartialEq)]
    #[repr(u32)]
    pub enum VerifierError {
        /// A direct call cannot make this change after setup: it goes through
        /// `propose_change`.
        UseTimelock = 10000,
        /// The bound vault is always a protocol address.
        VaultIsProtocol = 10001,
        /// A contract the answer depends on failed: the registry, the topics
        /// contract, an identity or an issuer. Or nobody could answer: no
        /// topic is required, or a required topic has no trusted issuer. Not
        /// a refusal.
        Unavailable = 10002,
        /// The `operator` named is not the admin.
        OperatorNotAdmin = 10003,
        /// No pending change has this id.
        ChangeNotFound = 10004,
        /// The change's delay has not elapsed.
        ChangeNotReady = 10005,
        /// As many changes as the timelock holds already wait.
        TooManyPendingChanges = 10006,
        /// Changes are instant until setup finishes; there is nothing to propose yet.
        SetupOpen = 10007,
        /// Only possible while setup is open, and only once.
        SetupClosed = 10008,
        /// Setup cannot finish before the contract is bound to its vault.
        VaultNotBound = 10009,
        /// The vault is winding down, so only removing a protocol address may
        /// be proposed or applied, and no admin hand-over is accepted.
        WindDownActive = 10010,
        /// The vault is paused, which holds every timelocked change.
        VaultPaused = 10011,
        /// The change's delay is shorter than the vault's notice, so an investor
        /// could not complete an exit before it lands.
        DelayBelowNotice = 10012,
        /// An admin hand-over offered during setup is still open. Setup finishes
        /// once it is accepted, cancelled or expired.
        AdminTransferPending = 10013,
    }
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ProtocolAddressAdded {
    #[topic]
    pub account: Address,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ProtocolAddressRemoved {
    #[topic]
    pub account: Address,
}

#[contractevent]
pub struct ChangeProposed {
    #[topic]
    pub id: u32,
    pub change: VerifierChange,
    pub eta: u64,
}

#[contractevent]
pub struct ChangeCancelled {
    #[topic]
    pub id: u32,
}

#[contractevent]
pub struct ChangeApplied {
    #[topic]
    pub id: u32,
    pub change: VerifierChange,
}

#[contractevent]
pub struct SetupFinished {}

#[contractevent]
pub struct VaultBound {
    #[topic]
    pub vault: Address,
}

#[contract]
pub struct IdentityVerifier;

#[contractimpl]
impl IdentityVerifier {
    /// Creates the verifier with its admin and the contracts it reads.
    ///
    /// # Arguments
    ///
    /// * `admin` - Names protocol addresses and changes the contracts read.
    /// * `registry` - The identity registry that links wallets to identities.
    /// * `topics` - The claim topics and trusted issuers contract.
    ///
    /// # Events
    ///
    /// * `IdentityRegistryStorageSet`, then `ClaimTopicsAndIssuersSet`
    ///
    /// # Authorization
    ///
    /// None: it runs once, at deployment.
    pub fn __constructor(e: &Env, admin: Address, registry: Address, topics: Address) {
        access_control::set_admin(e, &admin);
        storage::set_identity_registry_storage(e, &registry);
        storage::set_claim_topics_and_issuers(e, &topics);
        strata_storage::bump_instance(e);
    }

    /// Names the vault whose timelock this contract's changes wait for, and
    /// makes it a protocol address for good. Once, and only during setup.
    ///
    /// # Arguments
    ///
    /// * `vault` - The vault. A contract that does not answer
    ///   `timelock_clock` fails the call.
    ///
    /// # Errors
    ///
    /// * `SetupClosed` - Setup has finished, or a vault is already bound.
    ///
    /// # Events
    ///
    /// * `VaultBound`, then `ProtocolAddressAdded` unless the vault was one
    ///   already.
    ///
    /// # Authorization
    ///
    /// The admin signs.
    #[only_admin]
    pub fn bind_vault(e: &Env, vault: Address) {
        strata_storage::bump_instance(e);
        governance::bind_vault(e, &vault);
    }

    /// Ends the window in which changes are instant. It never reopens.
    ///
    /// # Errors
    ///
    /// * `SetupClosed` - Setup has already finished.
    /// * `AdminTransferPending` - An admin hand-over offered during setup is
    ///   still open.
    /// * `VaultNotBound` - No vault is bound.
    ///
    /// # Events
    ///
    /// * `SetupFinished`
    ///
    /// # Authorization
    ///
    /// The admin signs.
    #[only_admin]
    pub fn finish_setup(e: &Env) {
        strata_storage::bump_instance(e);
        governance::finish_setup(e);
    }

    /// Queues a change behind the vault's timelock and returns its id.
    ///
    /// # Arguments
    ///
    /// * `change` - A protocol address to add or remove, a new registry or
    ///   topics contract, or an admin hand-over.
    ///
    /// # Errors
    ///
    /// * `SetupOpen` - Setup has not finished; change it directly.
    /// * `VaultIsProtocol` - The change removes the bound vault.
    /// * `WindDownActive` - The vault is winding down, and the change does
    ///   not remove a protocol address.
    /// * `TooManyPendingChanges` - The queue is full.
    ///
    /// # Events
    ///
    /// * `ChangeProposed`, with its `eta` in seconds; time the vault spends
    ///   paused from now on moves it later.
    ///
    /// # Authorization
    ///
    /// The admin signs.
    #[only_admin]
    pub fn propose_change(e: &Env, change: VerifierChange) -> u32 {
        strata_storage::bump_instance(e);
        governance::propose(e, change)
    }

    /// Drops a pending change.
    ///
    /// # Arguments
    ///
    /// * `id` - The id `propose_change` returned.
    ///
    /// # Errors
    ///
    /// * `ChangeNotFound` - No pending change has this id.
    ///
    /// # Events
    ///
    /// * `ChangeCancelled`
    ///
    /// # Authorization
    ///
    /// The admin signs.
    #[only_admin]
    pub fn cancel_change(e: &Env, id: u32) {
        strata_storage::bump_instance(e);
        governance::cancel(e, id);
    }

    /// Lands a change whose delay has run.
    ///
    /// # Arguments
    ///
    /// * `id` - The id `propose_change` returned.
    ///
    /// # Errors
    ///
    /// * `ChangeNotFound` - No pending change has this id.
    /// * `WindDownActive` - The vault is winding down, and the change does
    ///   not remove a protocol address.
    /// * `VaultPaused` - The vault is paused.
    /// * `DelayBelowNotice` - The change's delay is shorter than the vault's
    ///   notice now.
    /// * `ChangeNotReady` - The delay, plus any time the vault spent paused
    ///   since, has not run.
    ///
    /// # Events
    ///
    /// * `ChangeApplied`, after the change's own event: `ProtocolAddressAdded`,
    ///   `ProtocolAddressRemoved`, `IdentityRegistryStorageSet`,
    ///   `ClaimTopicsAndIssuersSet` or `AdminTransferInitiated`.
    ///
    /// # Authorization
    ///
    /// The admin signs.
    #[only_admin]
    pub fn apply_change(e: &Env, id: u32) {
        strata_storage::bump_instance(e);
        governance::apply(e, id);
    }

    /// Every change still waiting, with the time in seconds it may land on
    /// the vault's clock as it reads now.
    pub fn pending_changes(e: &Env) -> Vec<VerifierPendingChange> {
        governance::pending(e)
    }

    /// Names an address that is verified without an identity. Instant during
    /// setup; after it, propose an `AddProtocolAddress` change.
    ///
    /// # Arguments
    ///
    /// * `account` - The address.
    ///
    /// # Errors
    ///
    /// * `UseTimelock` - Setup has finished.
    ///
    /// # Events
    ///
    /// * `ProtocolAddressAdded`, unless it was one already.
    ///
    /// # Authorization
    ///
    /// The admin signs.
    #[only_admin]
    pub fn add_protocol_address(e: &Env, account: Address) {
        guards::direct_change_allowed(e);
        strata_storage::bump_instance(e);
        protocol::add(e, &account);
    }

    /// Stops verifying an address without an identity. Instant during setup;
    /// after it, propose a `RemoveProtocolAddress` change.
    ///
    /// # Arguments
    ///
    /// * `account` - The address.
    ///
    /// # Errors
    ///
    /// * `UseTimelock` - Setup has finished.
    /// * `VaultIsProtocol` - `account` is the bound vault.
    ///
    /// # Events
    ///
    /// * `ProtocolAddressRemoved`, unless it was not one.
    ///
    /// # Authorization
    ///
    /// The admin signs.
    #[only_admin]
    pub fn remove_protocol_address(e: &Env, account: Address) {
        guards::direct_change_allowed(e);
        guards::not_the_vault(e, &account);
        strata_storage::bump_instance(e);
        protocol::remove(e, &account);
    }

    /// Whether `account` is verified without an identity: the bound vault, or
    /// an address governance named.
    pub fn is_protocol_address(e: &Env, account: Address) -> bool {
        protocol::is_protocol(e, &account)
    }

    /// The identity registry that links wallets to identities.
    pub fn identity_registry(e: &Env) -> Address {
        storage::identity_registry_storage(e)
    }

    /// Offers the admin role to `new_admin`, who takes it with
    /// `accept_admin_transfer`. An offer is instant only during setup; after
    /// it, propose an `Admin` change. Cancelling an offer stays instant.
    ///
    /// # Arguments
    ///
    /// * `new_admin` - The nominee, or the pending nominee when cancelling.
    /// * `live_until_ledger` - The last ledger number the nominee can accept
    ///   in; `0` cancels the pending offer.
    ///
    /// # Errors
    ///
    /// * `UseTimelock` - An offer after setup.
    /// * `RoleTransferError::InvalidLiveUntilLedger` - The ledger has passed or
    ///   is beyond the longest entry lifetime.
    /// * `RoleTransferError::NoPendingTransfer` - Nothing to cancel.
    /// * `RoleTransferError::InvalidPendingAccount` - The cancel names another
    ///   nominee.
    ///
    /// # Events
    ///
    /// * `AdminTransferInitiated`
    ///
    /// # Authorization
    ///
    /// The admin signs.
    pub fn transfer_admin_role(e: &Env, new_admin: Address, live_until_ledger: u32) {
        guards::direct_hand_over_allowed(e, live_until_ledger);
        strata_storage::bump_instance(e);
        access_control::transfer_admin_role(e, &new_admin, live_until_ledger);
    }

    /// Makes the nominee of a pending hand-over the admin. Refused while the
    /// vault winds down: no admin power changes hands then.
    ///
    /// # Errors
    ///
    /// * `WindDownActive` - The vault is winding down.
    /// * `RoleTransferError::NoPendingTransfer` - No offer is pending.
    /// * `RoleTransferError::TransferExpired` - The offer's last ledger has
    ///   passed.
    ///
    /// # Events
    ///
    /// * `AdminTransferCompleted`
    ///
    /// # Authorization
    ///
    /// The nominee signs.
    pub fn accept_admin_transfer(e: &Env) {
        guards::vault_not_winding_down(e);
        strata_storage::bump_instance(e);
        access_control::accept_admin_transfer(e);
    }

    /// The admin.
    pub fn get_admin(e: &Env) -> Option<Address> {
        access_control::get_admin(e)
    }
}

#[contractimpl(contracttrait)]
impl VaultBinding for IdentityVerifier {
    /// The vault whose timelock this contract's changes wait for, once
    /// `bind_vault` has named it.
    fn vault(e: &Env) -> Option<Address> {
        strata_timelock::setup::source(e)
    }

    /// Whether setup is still open, so changes are instant.
    fn setup_open(e: &Env) -> bool {
        strata_timelock::setup::is_open(e)
    }
}

#[contractimpl]
impl VerifierSetup for IdentityVerifier {
    /// Whether the identity setup is ready for `vault` under `governance`.
    /// False when any read fails.
    ///
    /// # Arguments
    ///
    /// * `vault` - The vault. This verifier, the registry and the topics
    ///   contract must be bound to it with setup finished, and it must be a
    ///   protocol address.
    /// * `governance` - The admin all three contracts must have.
    ///
    /// The topics contract must also be complete, and the registry must ask
    /// this verifier about claims.
    fn ready_for(e: Env, vault: Address, governance: Address) -> bool {
        readiness::ready_for(&e, &vault, &governance)
    }
}

#[contractimpl]
impl ClaimsCheck for IdentityVerifier {
    /// Panics unless `identity` holds a valid claim from a trusted issuer for
    /// every required topic. It never calls the registry, which asks it while
    /// linking a wallet.
    ///
    /// # Arguments
    ///
    /// * `identity` - The identity contract.
    ///
    /// # Errors
    ///
    /// * `RWAError::IdentityVerificationFailed` - A required topic has
    ///   trusted issuers, and each answered no.
    /// * `Unavailable` - No topic refused, and no topic is required, a
    ///   required topic has no trusted issuer, or a contract the answer
    ///   depends on failed.
    fn check_claims(e: Env, identity: Address) {
        strata_storage::bump_instance(&e);
        verification::check_claims(&e, &identity);
    }
}

#[contractimpl(contracttrait)]
impl identity_verification::IdentityVerifier for IdentityVerifier {
    /// Succeeds when `account` is a protocol address, or its identity holds a
    /// valid claim from a trusted issuer for every required topic. The share
    /// token calls it on every mint and transfer.
    ///
    /// # Arguments
    ///
    /// * `account` - The account.
    ///
    /// # Errors
    ///
    /// * `IRSError::IdentityNotFound` - The registry links no identity to
    ///   `account`.
    /// * `RWAError::IdentityVerificationFailed` - A required topic has
    ///   trusted issuers, and each answered no.
    /// * `Unavailable` - No topic refused, and no topic is required, a
    ///   required topic has no trusted issuer, or the registry, the topics
    ///   contract, the identity or an issuer failed.
    fn verify_identity(e: &Env, account: &Address) {
        strata_storage::bump_instance(e);
        verification::verify(e, account);
    }

    /// Always `None`: recovery is not offered, so the share token's
    /// `recover_balance` fails. A lost wallet's shares move by
    /// `legal_transfer`.
    ///
    /// # Arguments
    ///
    /// * `old_account` - Not read.
    fn recovery_target(_e: &Env, _old_account: &Address) -> Option<Address> {
        None
    }

    /// Names the claim topics and issuers contract. Instant during setup;
    /// after it, propose a `Topics` change.
    ///
    /// # Arguments
    ///
    /// * `claim_topics_and_issuers` - The topics contract.
    /// * `operator` - The admin.
    ///
    /// # Errors
    ///
    /// * `UseTimelock` - Setup has finished.
    /// * `OperatorNotAdmin` - `operator` is not the admin.
    ///
    /// # Events
    ///
    /// * `ClaimTopicsAndIssuersSet`
    ///
    /// # Authorization
    ///
    /// `operator` signs.
    fn set_claim_topics_and_issuers(e: &Env, claim_topics_and_issuers: Address, operator: Address) {
        guards::direct_change_allowed(e);
        guards::operator_is_admin(e, &operator);
        operator.require_auth();
        strata_storage::bump_instance(e);
        storage::set_claim_topics_and_issuers(e, &claim_topics_and_issuers);
    }
}

#[cfg(test)]
mod test;
