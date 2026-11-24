//! # Design
//!
//! - **A wallet and its identity, nothing more.** The registry links each
//!   wallet to one identity contract and stores no country data. The cost: a
//!   fund that needs country rules adds that storage itself.
//! - **Investors list themselves.** `onboard` deploys the investor's identity,
//!   adds the claims the investor brings and links the wallet, in one
//!   transaction the investor signs. The cost: the investor pays for the
//!   identity's deployment.
//! - **The identity's address is known in advance.** It derives from the
//!   wallet alone, so a provider signs claims before the identity exists. The
//!   cost: one identity per wallet in each registry; a wallet that onboards
//!   again gets the identity it had.
//! - **Only the kit's identity code is linked.** A link records the code
//!   hash its identity ran, and `stored_identity` stops answering if that
//!   code changes. Code the investor controls could fail on purpose and turn
//!   a refusal into a fault, which holds a priced deposit open. The cost: an
//!   identity on older kit code cannot be attached after the code changes,
//!   though `onboard` still relinks the identity this registry deployed for
//!   the wallet, on the kit code it was deployed with.
//! - **No link without passing claims.** Every way to link a wallet asks the
//!   verifier's `check_claims` about the identity first, and the transaction
//!   reverts if it panics. The registry never calls `verify_identity`, which
//!   reads the registry back, and Soroban refuses a call into a contract
//!   already running. The cost: the verifier answers two calls with one rule.
//! - **Delisting is a veto.** The compliance authority unlinks a wallet and
//!   vetoes it in one call, at once, even during a wind-down. A vetoed wallet
//!   cannot list itself again until the compliance authority lifts the veto;
//!   then it onboards itself. The cost: a wallet delisted by mistake waits
//!   for the authority.
//! - **No recovery and no token binding.** A lost wallet's investor onboards a
//!   new wallet, and its shares move by a legal transfer. The cost:
//!   OpenZeppelin's recovery flow is not available.
//! - **Changes wait for the vault's timelock.** After setup, the identity
//!   code, the verifier, the compliance authority and the admin change only
//!   through it, and none of them during a wind-down. The cost: a broken
//!   verifier stays until its replacement lands.
//! - **No upgrade.** The contract has no upgrade path. The cost: a fix means
//!   a new deployment, and every wallet links again.

#![no_std]

mod governance;
mod guards;
mod registry;

use soroban_sdk::{
    contract, contracterror, contractevent, contractimpl, contracttype, panic_with_error, Address,
    Bytes, BytesN, Env, String, Val, Vec,
};
use stellar_access::access_control;
use stellar_macros::only_admin;
use stellar_tokens::rwa::{
    identity_verification::identity_registry_storage::{IRSError, IdentityRegistryStorage},
    utils::token_binder::TokenBinder,
};
use strata_bindings::VaultBinding;

pub use governance::{RegistryChange, RegistryPendingChange, ADMIN_ACCEPT_LEDGERS};

strata_bindings::error_enum! {
    strata_bindings::IDENTITY_ERRORS,

    /// Identity registry failures, coded 10200 to 10399. Codes are stable once
    /// assigned and are never reused; a removed variant leaves its number
    /// retired.
    #[contracterror]
    #[derive(Copy, Clone, Debug, Eq, PartialEq)]
    #[repr(u32)]
    pub enum IdentityRegistryError {
        /// The compliance authority vetoed this wallet. Once it lifts the
        /// veto, the wallet can onboard itself again.
        Vetoed = 10200,
        /// The wallet is already linked to an identity.
        AlreadyRegistered = 10201,
        /// The identity's owner is not the wallet.
        NotIdentityOwner = 10202,
        /// Country data was given; the registry stores none.
        CountryDataNotStored = 10203,
        /// Identity recovery is not offered: a lost wallet onboards a new one.
        RecoveryNotOffered = 10204,
        /// The registry links no token.
        TokenBindingNotOffered = 10205,
        /// The identity does not run the code at `identity_wasm`, or is not a
        /// contract.
        NotKitIdentity = 10206,
        /// A direct call cannot make this change after setup: it goes through
        /// `propose_change`.
        UseTimelock = 10207,
        /// The `operator` named is not the compliance authority.
        OperatorNotCompliance = 10208,
        /// No pending change has this id.
        ChangeNotFound = 10209,
        /// The change's delay has not elapsed.
        ChangeNotReady = 10210,
        /// As many changes as the timelock holds already wait.
        TooManyPendingChanges = 10211,
        /// Changes are instant until setup finishes; there is nothing to propose yet.
        SetupOpen = 10212,
        /// Only possible while setup is open, and only once.
        SetupClosed = 10213,
        /// Setup cannot finish before the contract is bound to its vault.
        VaultNotBound = 10214,
        /// No verifier is bound, so no wallet can be linked and setup cannot
        /// finish.
        VerifierNotBound = 10215,
        /// The vault is winding down, so no change may be proposed or applied,
        /// and no admin hand-over is accepted.
        WindDownActive = 10216,
        /// The vault is paused, which holds every timelocked change.
        VaultPaused = 10217,
        /// The change's delay is shorter than the vault's notice, so an investor
        /// could not complete an exit before it lands.
        DelayBelowNotice = 10218,
        /// An admin hand-over offered during setup is still open. Setup finishes
        /// once it is accepted, cancelled or expired.
        AdminTransferPending = 10219,
        /// A value set at construction is missing, which only a contract that
        /// was never constructed can show.
        NotInitialized = 10220,
    }
}

/// A claim an issuer signed about the identity at `identity_address`, in the
/// shape the identity's `add_claim` takes.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SignedClaim {
    pub topic: u32,
    pub scheme: u32,
    pub issuer: Address,
    pub signature: Bytes,
    pub data: Bytes,
    pub uri: String,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct IdentityRegistered {
    #[topic]
    pub account: Address,
    #[topic]
    pub identity: Address,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct IdentityRemoved {
    #[topic]
    pub account: Address,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct VetoSet {
    #[topic]
    pub account: Address,
    pub vetoed: bool,
}

#[contractevent]
pub struct ChangeProposed {
    #[topic]
    pub id: u32,
    pub change: RegistryChange,
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
    pub change: RegistryChange,
}

#[contractevent]
pub struct SetupFinished {}

#[contractevent]
pub struct VaultBound {
    #[topic]
    pub vault: Address,
}

#[contractevent]
pub struct VerifierBound {
    #[topic]
    pub verifier: Address,
}

#[contract]
pub struct IdentityRegistry;

#[contractimpl]
impl IdentityRegistry {
    /// Creates the registry with its admin, its compliance authority and the
    /// identity code it deploys.
    ///
    /// # Arguments
    ///
    /// * `admin` - Binds the vault and the verifier, and proposes changes.
    /// * `compliance` - Lists, delists and vetoes wallets.
    /// * `identity_wasm` - The hash of the investor identity's Wasm.
    ///
    /// # Authorization
    ///
    /// None: it runs once, at deployment.
    pub fn __constructor(e: &Env, admin: Address, compliance: Address, identity_wasm: BytesN<32>) {
        access_control::set_admin(e, &admin);
        governance::set_compliance(e, &compliance);
        governance::set_identity_wasm(e, &identity_wasm);
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

    /// Names the verifier whose `check_claims` every link waits for. Instant
    /// during setup, and may replace an earlier one; after it, propose a
    /// `Verifier` change.
    ///
    /// # Arguments
    ///
    /// * `verifier` - The identity verifier.
    ///
    /// # Errors
    ///
    /// * `UseTimelock` - Setup has finished.
    ///
    /// # Events
    ///
    /// * `VerifierBound`
    ///
    /// # Authorization
    ///
    /// The admin signs.
    #[only_admin]
    pub fn bind_verifier(e: &Env, verifier: Address) {
        guards::direct_change_allowed(e);
        strata_storage::bump_instance(e);
        governance::bind_verifier(e, &verifier);
    }

    /// Ends the window in which the verifier and the admin change at once. It
    /// never reopens.
    ///
    /// # Errors
    ///
    /// * `SetupClosed` - Setup has already finished.
    /// * `AdminTransferPending` - An admin hand-over offered during setup is
    ///   still open.
    /// * `VerifierNotBound` - No verifier is bound.
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
    /// * `change` - New identity code, verifier, compliance authority, or an
    ///   admin hand-over.
    ///
    /// # Errors
    ///
    /// * `SetupOpen` - Setup has not finished.
    /// * `WindDownActive` - The vault is winding down.
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
    pub fn propose_change(e: &Env, change: RegistryChange) -> u32 {
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
    /// * `WindDownActive` - The vault is winding down.
    /// * `VaultPaused` - The vault is paused.
    /// * `DelayBelowNotice` - The change's delay is shorter than the vault's
    ///   notice now.
    /// * `ChangeNotReady` - The delay, plus any time the vault spent paused
    ///   since, has not run.
    ///
    /// # Events
    ///
    /// * `ChangeApplied`, after `AdminTransferInitiated` for a hand-over.
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
    pub fn pending_changes(e: &Env) -> Vec<RegistryPendingChange> {
        governance::pending(e)
    }

    /// Deploys the caller's identity, adds the claims and links the wallet to
    /// it, once the verifier accepts the claims. Returns the identity. A wallet
    /// onboarding again keeps the identity deployed the first time.
    ///
    /// # Arguments
    ///
    /// * `account` - The investor's wallet, which owns the identity.
    /// * `claims` - Claims signed for the address `identity_address` gives.
    ///
    /// # Errors
    ///
    /// * `Vetoed` - The compliance authority vetoed the wallet.
    /// * `AlreadyRegistered` - The wallet is linked already.
    /// * `VerifierNotBound` - No verifier is bound.
    /// * The issuer's refusal of a claim, or the verifier's refusal or fault
    ///   from `check_claims`. Nothing is kept.
    ///
    /// # Events
    ///
    /// * `IdentityRegistered`
    ///
    /// # Authorization
    ///
    /// `account` signs, covering each claim's `add_claim` on the identity.
    pub fn onboard(e: &Env, account: Address, claims: Vec<SignedClaim>) -> Address {
        guards::not_vetoed(e, &account);
        guards::not_registered(e, &account);
        guards::verifier_bound(e);
        account.require_auth();
        strata_storage::bump_instance(e);
        let (identity, code) = registry::deploy_identity(e, &account);
        registry::add_claims(e, &identity, &claims);
        registry::register(e, &account, &identity, code);
        identity
    }

    /// Links the caller's wallet to an identity it already owns, once the
    /// verifier accepts the identity's claims.
    ///
    /// # Arguments
    ///
    /// * `account` - The investor's wallet.
    /// * `identity` - An identity contract whose `owner` is `account`.
    ///
    /// # Errors
    ///
    /// * `Vetoed` - The compliance authority vetoed the wallet.
    /// * `AlreadyRegistered` - The wallet is linked already.
    /// * `VerifierNotBound` - No verifier is bound.
    /// * `NotKitIdentity` - `identity` does not run the code at
    ///   `identity_wasm`.
    /// * `NotIdentityOwner` - `identity` belongs to another owner.
    /// * The verifier's refusal or fault from `check_claims`.
    ///
    /// # Events
    ///
    /// * `IdentityRegistered`
    ///
    /// # Authorization
    ///
    /// `account` signs.
    pub fn attach(e: &Env, account: Address, identity: Address) {
        guards::not_vetoed(e, &account);
        guards::not_registered(e, &account);
        guards::verifier_bound(e);
        guards::runs_kit_identity_code(e, &identity);
        guards::owns_identity(e, &account, &identity);
        account.require_auth();
        strata_storage::bump_instance(e);
        registry::register(e, &account, &identity, governance::identity_wasm(e));
    }

    /// The address `onboard` deploys `account`'s identity at, so a provider
    /// can sign claims for it first.
    pub fn identity_address(e: &Env, account: Address) -> Address {
        registry::identity_address(e, &account)
    }

    /// Lifts the compliance authority's veto on a wallet, at once. The wallet
    /// stays unlinked until it onboards again or is listed.
    ///
    /// # Arguments
    ///
    /// * `account` - The wallet.
    /// * `operator` - The compliance authority.
    ///
    /// # Errors
    ///
    /// * `OperatorNotCompliance` - `operator` is not the compliance
    ///   authority.
    ///
    /// # Events
    ///
    /// * `VetoSet`, with `vetoed` false, when a veto was lifted.
    ///
    /// # Authorization
    ///
    /// `operator` signs.
    pub fn lift_veto(e: &Env, account: Address, operator: Address) {
        guards::operator_is_compliance(e, &operator);
        operator.require_auth();
        strata_storage::bump_instance(e);
        registry::lift_veto(e, &account);
    }

    /// Whether the compliance authority vetoed the wallet.
    pub fn is_vetoed(e: &Env, account: Address) -> bool {
        registry::is_vetoed(e, &account)
    }

    /// The hash of the Wasm `onboard` deploys a new identity from, and that
    /// `attach` and `add_identity` require. Onboarding a wallet again reuses
    /// the identity this registry deployed for it, on the code it was
    /// deployed with. Links made before a change keep their code.
    pub fn identity_wasm(e: &Env) -> BytesN<32> {
        governance::identity_wasm(e)
    }

    /// The verifier whose `check_claims` every link waits for.
    ///
    /// # Errors
    ///
    /// * `VerifierNotBound` - No verifier is bound.
    pub fn verifier(e: &Env) -> Address {
        governance::verifier(e)
    }

    /// The compliance authority, which lists, delists and vetoes wallets.
    pub fn compliance(e: &Env) -> Address {
        governance::compliance(e)
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
impl VaultBinding for IdentityRegistry {
    /// The vault whose timelock this contract's changes wait for, once
    /// `bind_vault` has named it.
    fn vault(e: &Env) -> Option<Address> {
        strata_timelock::setup::source(e)
    }

    /// Whether setup is still open, so the verifier and the admin change at
    /// once.
    fn setup_open(e: &Env) -> bool {
        strata_timelock::setup::is_open(e)
    }
}

#[contractimpl(contracttrait)]
impl TokenBinder for IdentityRegistry {
    /// Refused: the registry links no token.
    ///
    /// # Errors
    ///
    /// * `TokenBindingNotOffered` - Always.
    fn bind_token(e: &Env, _token: Address, _operator: Address) {
        panic_with_error!(e, IdentityRegistryError::TokenBindingNotOffered)
    }

    /// Refused: the registry links no token.
    ///
    /// # Errors
    ///
    /// * `TokenBindingNotOffered` - Always.
    fn unbind_token(e: &Env, _token: Address, _operator: Address) {
        panic_with_error!(e, IdentityRegistryError::TokenBindingNotOffered)
    }
}

#[contractimpl(contracttrait)]
impl IdentityRegistryStorage for IdentityRegistry {
    /// Links a wallet to an identity, once the verifier accepts the
    /// identity's claims.
    ///
    /// # Arguments
    ///
    /// * `account` - The wallet.
    /// * `identity` - Its identity contract.
    /// * `country_data_list` - Must be empty: the registry stores none.
    /// * `operator` - The compliance authority.
    ///
    /// # Errors
    ///
    /// * `OperatorNotCompliance` - `operator` is not the compliance
    ///   authority.
    /// * `CountryDataNotStored` - The list is not empty.
    /// * `Vetoed` - The wallet is vetoed; lift the veto first.
    /// * `AlreadyRegistered` - The wallet is linked already.
    /// * `VerifierNotBound` - No verifier is bound.
    /// * `NotKitIdentity` - `identity` does not run the code at
    ///   `identity_wasm`.
    /// * The verifier's refusal or fault from `check_claims`.
    ///
    /// # Events
    ///
    /// * `IdentityRegistered`
    ///
    /// # Authorization
    ///
    /// `operator` signs.
    fn add_identity(
        e: &Env,
        account: Address,
        identity: Address,
        country_data_list: Vec<Val>,
        operator: Address,
    ) {
        guards::operator_is_compliance(e, &operator);
        guards::no_country_data(e, &country_data_list);
        guards::not_vetoed(e, &account);
        guards::not_registered(e, &account);
        guards::verifier_bound(e);
        guards::runs_kit_identity_code(e, &identity);
        operator.require_auth();
        strata_storage::bump_instance(e);
        registry::register(e, &account, &identity, governance::identity_wasm(e));
    }

    /// Links `accounts[i]` to `identities[i]` for each `i`, as `add_identity`
    /// would; one refusal reverts them all.
    ///
    /// # Arguments
    ///
    /// * `accounts` - The wallets.
    /// * `identities` - Their identity contracts.
    /// * `country_data_lists` - One empty list per wallet.
    /// * `operator` - The compliance authority.
    ///
    /// # Errors
    ///
    /// * `OperatorNotCompliance` - `operator` is not the compliance
    ///   authority.
    /// * `IRSError::BatchSizeMismatch` - The lists differ in length.
    /// * `VerifierNotBound` - No verifier is bound.
    /// * Any refusal of `add_identity`, for any wallet.
    ///
    /// # Events
    ///
    /// * `IdentityRegistered`, for each wallet.
    ///
    /// # Authorization
    ///
    /// `operator` signs.
    fn batch_add_identity(
        e: &Env,
        accounts: Vec<Address>,
        identities: Vec<Address>,
        country_data_lists: Vec<Vec<Val>>,
        operator: Address,
    ) {
        guards::operator_is_compliance(e, &operator);
        guards::same_lengths(e, &accounts, &identities, &country_data_lists);
        guards::verifier_bound(e);
        operator.require_auth();
        strata_storage::bump_instance(e);
        let code = governance::identity_wasm(e);
        for ((account, identity), country_data_list) in accounts
            .iter()
            .zip(identities.iter())
            .zip(country_data_lists.iter())
        {
            guards::no_country_data(e, &country_data_list);
            guards::not_vetoed(e, &account);
            guards::not_registered(e, &account);
            guards::runs_kit_identity_code(e, &identity);
            registry::register(e, &account, &identity, code.clone());
        }
    }

    /// Unlinks a wallet and vetoes it, at once, so it cannot list itself
    /// again. A wallet with no identity is vetoed all the same.
    ///
    /// # Arguments
    ///
    /// * `account` - The wallet.
    /// * `operator` - The compliance authority.
    ///
    /// # Errors
    ///
    /// * `OperatorNotCompliance` - `operator` is not the compliance
    ///   authority.
    ///
    /// # Events
    ///
    /// * `IdentityRemoved`, when a link existed.
    /// * `VetoSet`, with `vetoed` true.
    ///
    /// # Authorization
    ///
    /// `operator` signs.
    fn remove_identity(e: &Env, account: Address, operator: Address) {
        guards::operator_is_compliance(e, &operator);
        operator.require_auth();
        strata_storage::bump_instance(e);
        registry::unlink(e, &account);
        registry::veto(e, &account);
    }

    /// Refused: a lost wallet's investor onboards a new wallet instead.
    ///
    /// # Errors
    ///
    /// * `RecoveryNotOffered` - Always.
    fn recover_identity(e: &Env, _old_account: Address, _new_account: Address, _operator: Address) {
        panic_with_error!(e, IdentityRegistryError::RecoveryNotOffered)
    }

    /// The identity linked to a wallet. It calls no other contract.
    ///
    /// # Errors
    ///
    /// * `IRSError::IdentityNotFound` - The wallet is not linked, or its
    ///   identity no longer runs the code it ran when it was linked.
    fn stored_identity(e: &Env, account: Address) -> Address {
        strata_storage::bump_instance(e);
        registry::identity_of(e, &account)
            .unwrap_or_else(|| panic_with_error!(e, IRSError::IdentityNotFound))
    }

    /// Always `None`: recovery is not offered.
    fn get_recovered_to(_e: &Env, _old_account: Address) -> Option<Address> {
        None
    }
}

#[cfg(test)]
mod test;
