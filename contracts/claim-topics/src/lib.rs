//! # Design
//!
//! - **One list per vault.** Governance names the claim topics an investor
//!   must hold and the issuers trusted for each, on OpenZeppelin's storage.
//!   The cost: two funds with the same rules still keep two lists.
//! - **Only the kit's issuer code is trusted.** An issuer is added only when
//!   its contract runs the Wasm whose hash this contract stores, so the
//!   verifier knows every refusal it can return. The cost: a provider cannot
//!   bring its own issuer code, and new issuer code waits for the timelock.
//! - **The code is checked once, when the issuer is added.** An issuer stays
//!   trusted when the stored hash changes, and the host reads an executable
//!   reference as the Wasm it points at now, so an issuer deployed through one
//!   passes and its owner may swap the code later. The cost: governance must
//!   trust only issuers deployed straight from the kit's Wasm.
//! - **Changes wait for the vault's timelock.** After setup, topic, issuer,
//!   issuer code and admin changes wait, and a wind-down refuses them, except
//!   removing a topic or an issuer: a faulty issuer must still come off. The
//!   cost: no issuer can be added for the rest of an active wind-down.
//! - **The operator is the admin.** OpenZeppelin's calls take an `operator`;
//!   it must be the admin, and it signs. The cost: the admin cannot delegate
//!   those calls.
//! - **Completeness is reported, not enforced.** `is_complete` says whether
//!   every topic has an issuer, for the verifier's readiness check. The cost:
//!   a removal or a topic update after setup can leave a topic with no
//!   issuer, and the verifier then lets no one in, as a fault, until one is
//!   added.
//! - **No upgrade.** The contract has no upgrade path. The cost: a fix means
//!   a new deployment and a verifier change, which waits for the vault's
//!   timelock after setup.

#![no_std]

mod extend;
mod governance;
mod guards;

use soroban_sdk::{
    contract, contracterror, contractevent, contractimpl, Address, BytesN, Env, Map, Vec,
};
use stellar_access::access_control;
use stellar_macros::only_admin;
use stellar_tokens::rwa::identity_verification::claim_topics_and_issuers::{
    storage, ClaimTopicsAndIssuers,
};
use strata_bindings::VaultBinding;

pub use governance::{TopicsChange, TopicsPendingChange, ADMIN_ACCEPT_LEDGERS};

strata_bindings::error_enum! {
    strata_bindings::IDENTITY_ERRORS,

    /// Claim topics contract failures, coded 10400 to 10599. Codes are stable
    /// once assigned and are never reused; a removed variant leaves its number
    /// retired.
    #[contracterror]
    #[derive(Copy, Clone, Debug, Eq, PartialEq)]
    #[repr(u32)]
    pub enum ClaimTopicsContractError {
        /// A direct call cannot make this change after setup: it goes through
        /// `propose_change`.
        UseTimelock = 10400,
        /// The issuer does not run the code at `issuer_wasm`, or is not a
        /// contract.
        NotKitIssuer = 10401,
        /// The `operator` named is not the admin.
        OperatorNotAdmin = 10402,
        /// No pending change has this id.
        ChangeNotFound = 10403,
        /// The change's delay has not elapsed.
        ChangeNotReady = 10404,
        /// As many changes as the timelock holds already wait.
        TooManyPendingChanges = 10405,
        /// Changes are instant until setup finishes; there is nothing to propose yet.
        SetupOpen = 10406,
        /// Only possible while setup is open, and only once.
        SetupClosed = 10407,
        /// Setup cannot finish before the contract is bound to its vault.
        VaultNotBound = 10408,
        /// The vault is winding down, so only a removal may be proposed or
        /// applied, and no admin hand-over is accepted.
        WindDownActive = 10409,
        /// The vault is paused, which holds every timelocked change.
        VaultPaused = 10410,
        /// The change's delay is shorter than the vault's notice, so an investor
        /// could not complete an exit before it lands.
        DelayBelowNotice = 10411,
        /// An admin hand-over offered during setup is still open. Setup finishes
        /// once it is accepted, cancelled or expired.
        AdminTransferPending = 10412,
        /// The issuer code hash is missing, which only a contract that was
        /// never constructed can show.
        NotInitialized = 10413,
    }
}

#[contractevent]
pub struct ChangeProposed {
    #[topic]
    pub id: u32,
    pub change: TopicsChange,
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
    pub change: TopicsChange,
}

#[contractevent]
pub struct SetupFinished {}

#[contractevent]
pub struct VaultBound {
    #[topic]
    pub vault: Address,
}

#[contract]
pub struct ClaimTopics;

#[contractimpl]
impl ClaimTopics {
    /// Creates the contract with its admin and the issuer code it trusts.
    ///
    /// # Arguments
    ///
    /// * `admin` - Changes the topics and the trusted issuers.
    /// * `issuer_wasm` - The hash of the kit issuer's Wasm. Only contracts
    ///   running it can be trusted.
    ///
    /// # Authorization
    ///
    /// None: it runs once, at deployment.
    pub fn __constructor(e: &Env, admin: Address, issuer_wasm: BytesN<32>) {
        access_control::set_admin(e, &admin);
        governance::set_issuer_wasm(e, &issuer_wasm);
    }

    /// Names the vault whose timelock this contract's changes wait for. Once,
    /// and only during setup.
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
    /// * `VaultBound`
    ///
    /// # Authorization
    ///
    /// The admin signs.
    #[only_admin]
    pub fn bind_vault(e: &Env, vault: Address) {
        strata_storage::bump_instance(e);
        governance::bind_vault(e, &vault);
    }

    /// Ends the window in which topic and issuer changes are instant. It never
    /// reopens.
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
    /// * `change` - A topic or a trusted issuer to add, remove or update, new
    ///   issuer code, or an admin hand-over.
    ///
    /// # Errors
    ///
    /// * `SetupOpen` - Setup has not finished; change it directly.
    /// * `WindDownActive` - The vault is winding down, and the change does
    ///   not remove a topic or an issuer.
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
    pub fn propose_change(e: &Env, change: TopicsChange) -> u32 {
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
    ///   not remove a topic or an issuer.
    /// * `VaultPaused` - The vault is paused.
    /// * `DelayBelowNotice` - The change's delay is shorter than the vault's
    ///   notice now.
    /// * `ChangeNotReady` - The delay, plus any time the vault spent paused
    ///   since, has not run.
    /// * `NotKitIssuer` - An issuer to add does not run the code at
    ///   `issuer_wasm` now.
    /// * `ClaimTopicsAndIssuersError` - OpenZeppelin refuses the topic or
    ///   issuer change as the direct call would.
    ///
    /// # Events
    ///
    /// * `ChangeApplied`, after the change's own OpenZeppelin event or
    ///   `AdminTransferInitiated`. An `IssuerWasm` change emits only
    ///   `ChangeApplied`.
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
    pub fn pending_changes(e: &Env) -> Vec<TopicsPendingChange> {
        governance::pending(e)
    }

    /// The hash of the Wasm every newly trusted issuer must run.
    pub fn issuer_wasm(e: &Env) -> BytesN<32> {
        governance::issuer_wasm(e)
    }

    /// Whether at least one topic is required and every required topic has
    /// at least one trusted issuer.
    pub fn is_complete(e: &Env) -> bool {
        let topics = storage::get_claim_topics(e);
        !topics.is_empty()
            && topics
                .iter()
                .all(|topic| !storage::get_claim_topic_issuers(e, topic).is_empty())
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
impl VaultBinding for ClaimTopics {
    /// The vault whose timelock this contract's changes wait for, once
    /// `bind_vault` has named it.
    fn vault(e: &Env) -> Option<Address> {
        strata_timelock::setup::source(e)
    }

    /// Whether setup is still open, so topic and issuer changes are instant.
    fn setup_open(e: &Env) -> bool {
        strata_timelock::setup::is_open(e)
    }
}

#[contractimpl(contracttrait)]
impl ClaimTopicsAndIssuers for ClaimTopics {
    /// Requires a claim topic. Instant during setup; after it, propose an
    /// `AddClaimTopic` change.
    ///
    /// # Arguments
    ///
    /// * `claim_topic` - The topic number.
    /// * `operator` - The admin.
    ///
    /// # Errors
    ///
    /// * `UseTimelock` - Setup has finished.
    /// * `OperatorNotAdmin` - `operator` is not the admin.
    /// * `ClaimTopicsAndIssuersError::ClaimTopicAlreadyExists` - The topic is
    ///   already required.
    /// * `ClaimTopicsAndIssuersError::MaxClaimTopicsLimitReached` - No room
    ///   for another topic.
    ///
    /// # Events
    ///
    /// * `ClaimTopicAdded`
    ///
    /// # Authorization
    ///
    /// `operator` signs.
    fn add_claim_topic(e: &Env, claim_topic: u32, operator: Address) {
        guards::direct_change_allowed(e);
        guards::operator_is_admin(e, &operator);
        operator.require_auth();
        strata_storage::bump_instance(e);
        governance::add_topic(e, claim_topic);
    }

    /// Stops requiring a claim topic, and drops it from every issuer.
    /// Instant during setup; after it, propose a `RemoveClaimTopic` change.
    ///
    /// # Arguments
    ///
    /// * `claim_topic` - The topic number.
    /// * `operator` - The admin.
    ///
    /// # Errors
    ///
    /// * `UseTimelock` - Setup has finished.
    /// * `OperatorNotAdmin` - `operator` is not the admin.
    /// * `ClaimTopicsAndIssuersError::ClaimTopicDoesNotExist` - The topic is
    ///   not required.
    ///
    /// # Events
    ///
    /// * `ClaimTopicRemoved`
    ///
    /// # Authorization
    ///
    /// `operator` signs.
    fn remove_claim_topic(e: &Env, claim_topic: u32, operator: Address) {
        guards::direct_change_allowed(e);
        guards::operator_is_admin(e, &operator);
        operator.require_auth();
        strata_storage::bump_instance(e);
        storage::remove_claim_topic(e, claim_topic);
    }

    /// Trusts an issuer for some of the required topics. Instant during
    /// setup; after it, propose an `AddTrustedIssuer` change.
    ///
    /// # Arguments
    ///
    /// * `trusted_issuer` - A contract running the code at `issuer_wasm`.
    /// * `claim_topics` - Required topics it may attest, none repeated.
    /// * `operator` - The admin.
    ///
    /// # Errors
    ///
    /// * `UseTimelock` - Setup has finished.
    /// * `OperatorNotAdmin` - `operator` is not the admin.
    /// * `NotKitIssuer` - `trusted_issuer` runs other code.
    /// * `ClaimTopicsAndIssuersError` - The topics are empty, repeated, not
    ///   required or too many, the issuer is already trusted, or no room is
    ///   left for another.
    ///
    /// # Events
    ///
    /// * `TrustedIssuerAdded`
    ///
    /// # Authorization
    ///
    /// `operator` signs.
    fn add_trusted_issuer(
        e: &Env,
        trusted_issuer: Address,
        claim_topics: Vec<u32>,
        operator: Address,
    ) {
        guards::direct_change_allowed(e);
        guards::operator_is_admin(e, &operator);
        guards::runs_kit_issuer_code(e, &trusted_issuer);
        operator.require_auth();
        strata_storage::bump_instance(e);
        governance::add_issuer(e, &trusted_issuer, &claim_topics);
    }

    /// Stops trusting an issuer. Instant during setup; after it, propose a
    /// `RemoveTrustedIssuer` change.
    ///
    /// # Arguments
    ///
    /// * `trusted_issuer` - A trusted issuer.
    /// * `operator` - The admin.
    ///
    /// # Errors
    ///
    /// * `UseTimelock` - Setup has finished.
    /// * `OperatorNotAdmin` - `operator` is not the admin.
    /// * `ClaimTopicsAndIssuersError::IssuerDoesNotExist` - The issuer is not
    ///   trusted.
    ///
    /// # Events
    ///
    /// * `TrustedIssuerRemoved`
    ///
    /// # Authorization
    ///
    /// `operator` signs.
    fn remove_trusted_issuer(e: &Env, trusted_issuer: Address, operator: Address) {
        guards::direct_change_allowed(e);
        guards::operator_is_admin(e, &operator);
        operator.require_auth();
        strata_storage::bump_instance(e);
        storage::remove_trusted_issuer(e, &trusted_issuer);
    }

    /// Replaces the topics a trusted issuer may attest. Instant during setup;
    /// after it, propose an `UpdateIssuerTopics` change.
    ///
    /// # Arguments
    ///
    /// * `trusted_issuer` - A trusted issuer.
    /// * `claim_topics` - Required topics it may attest, none repeated.
    /// * `operator` - The admin.
    ///
    /// # Errors
    ///
    /// * `UseTimelock` - Setup has finished.
    /// * `OperatorNotAdmin` - `operator` is not the admin.
    /// * `ClaimTopicsAndIssuersError` - The issuer is not trusted, or the
    ///   topics are empty, repeated, not required or too many.
    ///
    /// # Events
    ///
    /// * `IssuerTopicsUpdated`
    ///
    /// # Authorization
    ///
    /// `operator` signs.
    fn update_issuer_claim_topics(
        e: &Env,
        trusted_issuer: Address,
        claim_topics: Vec<u32>,
        operator: Address,
    ) {
        guards::direct_change_allowed(e);
        guards::operator_is_admin(e, &operator);
        operator.require_auth();
        strata_storage::bump_instance(e);
        storage::update_issuer_claim_topics(e, &trusted_issuer, &claim_topics);
    }
}

#[cfg(test)]
mod test;
