//! Testnet-only stub — in production this is an external modular-compliance
//! module (ERC-3643), not part of this product. Do not deploy to mainnet.
#![no_std]

mod governance;
mod guards;

use soroban_sdk::{
    contract, contracterror, contractevent, contractimpl, contractmeta, Address, Env, Vec,
};

contractmeta!(
    key = "stub",
    val = "testnet-only; prod = external compliance module"
);
use stellar_access::access_control;
use stellar_macros::only_admin;
use stellar_tokens::rwa::{compliance, compliance::ComplianceHook, utils::token_binder};
use strata_bindings::VaultBinding;

pub use governance::{ComplianceChange, CompliancePendingChange, ADMIN_ACCEPT_LEDGERS};

strata_bindings::error_enum! {
    strata_bindings::COMPLIANCE_ERRORS,

    /// Compliance contract failures, coded 8000 to 8999. Codes are stable once
    /// assigned and are never reused; a removed variant leaves its number
    /// retired.
    #[contracterror]
    #[derive(Copy, Clone, Debug, Eq, PartialEq)]
    #[repr(u32)]
    pub enum ComplianceContractError {
        /// No pending change has this id.
        ChangeNotFound = 8001,
        /// The change's delay has not elapsed.
        ChangeNotReady = 8002,
        /// As many changes as the timelock holds already wait.
        TooManyPendingChanges = 8003,
        /// Changes are instant until setup finishes; there is nothing to propose yet.
        SetupOpen = 8004,
        /// A direct call cannot make this change after setup: it goes through
        /// `propose_change`.
        UseTimelock = 8005,
        /// Only possible while setup is open, and only once.
        SetupClosed = 8006,
        /// Setup cannot finish before the contract is bound to its vault.
        VaultNotBound = 8007,
        /// The vault is winding down, so no change may be proposed or applied.
        WindDownActive = 8008,
        /// The vault is paused, which holds every timelocked change.
        VaultPaused = 8009,
        /// The change's delay is shorter than the vault's notice, so an investor
        /// could not complete an exit before it lands.
        DelayBelowNotice = 8010,
        /// An admin hand-over offered during setup is still open. Setup finishes
        /// once it is accepted, cancelled or expired, so no nominee from setup can
        /// accept after changes start to wait.
        AdminTransferPending = 8011,
    }
}

#[contractevent]
pub struct ChangeProposed {
    #[topic]
    pub id: u32,
    pub change: ComplianceChange,
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
    pub change: ComplianceChange,
}

#[contractevent]
pub struct SetupFinished {}

#[contractevent]
pub struct VaultBound {
    #[topic]
    pub vault: Address,
}

#[contract]
pub struct Compliance;

#[contractimpl]
impl Compliance {
    /// Creates the contract with its admin.
    ///
    /// # Arguments
    ///
    /// * `admin` - Changes the modules and the bound tokens.
    ///
    /// # Authorization
    ///
    /// None: it runs once, at deployment.
    pub fn __constructor(e: &Env, admin: Address) {
        access_control::set_admin(e, &admin);
        strata_storage::bump_instance(e);
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

    /// Ends the window in which module and binding changes are instant. It
    /// never reopens.
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
    /// * `change` - A module to add or remove, a token to bind or unbind, or
    ///   an admin hand-over.
    ///
    /// # Errors
    ///
    /// * `SetupOpen` - Setup has not finished; change it directly.
    /// * `WindDownActive` - The vault is winding down.
    /// * `TooManyPendingChanges` - The queue is full.
    ///
    /// # Events
    ///
    /// * `ChangeProposed`, with its `eta` in seconds.
    ///
    /// # Authorization
    ///
    /// The admin signs.
    #[only_admin]
    pub fn propose_change(e: &Env, change: ComplianceChange) -> u32 {
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
    /// * `ComplianceError` or `TokenBinderError` - The module or token change
    ///   is refused as `add_module_to`, `remove_module_from`, `bind_token` or
    ///   `unbind_token` would refuse it.
    ///
    /// # Events
    ///
    /// * `ChangeApplied`, after the change's own: `ModuleAdded`,
    ///   `ModuleRemoved`, `TokenBound`, `TokenUnbound` or
    ///   `AdminTransferInitiated`.
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
    pub fn pending_changes(e: &Env) -> Vec<CompliancePendingChange> {
        governance::pending(e)
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

    /// Makes the nominee of a pending hand-over the admin.
    ///
    /// # Errors
    ///
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
        strata_storage::bump_instance(e);
        access_control::accept_admin_transfer(e);
    }

    /// The admin.
    pub fn get_admin(e: &Env) -> Option<Address> {
        access_control::get_admin(e)
    }
}

#[contractimpl(contracttrait)]
impl VaultBinding for Compliance {
    /// The vault whose timelock this contract's changes wait for, once
    /// `bind_vault` has named it.
    fn vault(e: &Env) -> Option<Address> {
        strata_timelock::setup::source(e)
    }

    /// Whether setup is still open, so module and binding changes are
    /// instant.
    fn setup_open(e: &Env) -> bool {
        strata_timelock::setup::is_open(e)
    }
}

#[contractimpl(contracttrait)]
impl token_binder::TokenBinder for Compliance {
    /// Links `token` to these rules. Instant during setup; after it, propose a
    /// `BindToken` change.
    ///
    /// # Arguments
    ///
    /// * `token` - The share token.
    /// * `operator` - Not read; the admin signs instead.
    ///
    /// # Errors
    ///
    /// * `UseTimelock` - Setup has finished.
    /// * `TokenBinderError::TokenAlreadyBound` - `token` is already bound.
    /// * `TokenBinderError::MaxTokensReached` - No room for another token.
    ///
    /// # Events
    ///
    /// * `TokenBound`
    ///
    /// # Authorization
    ///
    /// The admin signs.
    #[only_admin]
    fn bind_token(e: &Env, token: Address, _operator: Address) {
        guards::direct_change_allowed(e);
        strata_storage::bump_instance(e);
        token_binder::bind_token(e, &token);
    }

    /// Unlinks `token`, after which its moves fail the hooks. Instant during
    /// setup; after it, propose an `UnbindToken` change.
    ///
    /// # Arguments
    ///
    /// * `token` - A bound token.
    /// * `operator` - Not read; the admin signs instead.
    ///
    /// # Errors
    ///
    /// * `UseTimelock` - Setup has finished.
    /// * `TokenBinderError::TokenNotFound` - `token` is not bound.
    ///
    /// # Events
    ///
    /// * `TokenUnbound`
    ///
    /// # Authorization
    ///
    /// The admin signs.
    #[only_admin]
    fn unbind_token(e: &Env, token: Address, _operator: Address) {
        guards::direct_change_allowed(e);
        strata_storage::bump_instance(e);
        token_binder::unbind_token(e, &token);
    }
}

/// The token calls the check before and the hook after every mint, burn and
/// transfer, which is what keeps this instance alive.
#[contractimpl(contracttrait)]
impl compliance::Compliance for Compliance {
    /// Registers `module` on `hook`. Instant during setup; after it, propose
    /// an `AddModule` change.
    ///
    /// # Arguments
    ///
    /// * `hook` - The check or the hook the module runs on.
    /// * `module` - The module contract.
    /// * `operator` - Not read; the admin signs instead.
    ///
    /// # Errors
    ///
    /// * `UseTimelock` - Setup has finished.
    /// * `ComplianceError::ModuleAlreadyRegistered` - `module` is already on
    ///   `hook`.
    /// * `ComplianceError::ModuleBoundExceeded` - `hook` has no room left.
    ///
    /// # Events
    ///
    /// * `ModuleAdded`
    ///
    /// # Authorization
    ///
    /// The admin signs.
    #[only_admin]
    fn add_module_to(e: &Env, hook: ComplianceHook, module: Address, _operator: Address) {
        guards::direct_change_allowed(e);
        strata_storage::bump_instance(e);
        compliance::storage::add_module_to(e, hook, module);
    }

    /// Removes `module` from `hook`. Instant during setup; after it, propose a
    /// `RemoveModule` change.
    ///
    /// # Arguments
    ///
    /// * `hook` - The check or the hook the module runs on.
    /// * `module` - The module contract.
    /// * `operator` - Not read; the admin signs instead.
    ///
    /// # Errors
    ///
    /// * `UseTimelock` - Setup has finished.
    /// * `ComplianceError::ModuleNotRegistered` - `module` is not on `hook`.
    ///
    /// # Events
    ///
    /// * `ModuleRemoved`
    ///
    /// # Authorization
    ///
    /// The admin signs.
    #[only_admin]
    fn remove_module_from(e: &Env, hook: ComplianceHook, module: Address, _operator: Address) {
        guards::direct_change_allowed(e);
        strata_storage::bump_instance(e);
        compliance::storage::remove_module_from(e, hook, module);
    }

    /// Runs the `Transferred` modules after a bound token moves shares.
    ///
    /// # Arguments
    ///
    /// * `from`, `to` - The two ends of the move.
    /// * `amount` - Share base units moved.
    /// * `token` - The calling token.
    ///
    /// # Errors
    ///
    /// * `ComplianceError::TokenNotBound` - `token` is not bound here.
    /// * A module's own error.
    ///
    /// # Authorization
    ///
    /// `token` signs, as the calling contract.
    fn transferred(e: &Env, from: Address, to: Address, amount: i128, token: Address) {
        strata_storage::bump_instance(e);
        compliance::storage::transferred(e, from, to, amount, token);
    }

    /// Runs the `Created` modules after a bound token mints shares.
    ///
    /// # Arguments
    ///
    /// * `to` - The account credited.
    /// * `amount` - Share base units minted.
    /// * `token` - The calling token.
    ///
    /// # Errors
    ///
    /// * `ComplianceError::TokenNotBound` - `token` is not bound here.
    /// * A module's own error.
    ///
    /// # Authorization
    ///
    /// `token` signs, as the calling contract.
    fn created(e: &Env, to: Address, amount: i128, token: Address) {
        strata_storage::bump_instance(e);
        compliance::storage::created(e, to, amount, token);
    }

    /// Runs the `Destroyed` modules after a bound token burns shares.
    ///
    /// # Arguments
    ///
    /// * `from` - The account debited.
    /// * `amount` - Share base units burned.
    /// * `token` - The calling token.
    ///
    /// # Errors
    ///
    /// * `ComplianceError::TokenNotBound` - `token` is not bound here.
    /// * A module's own error.
    ///
    /// # Authorization
    ///
    /// `token` signs, as the calling contract.
    fn destroyed(e: &Env, from: Address, amount: i128, token: Address) {
        strata_storage::bump_instance(e);
        compliance::storage::destroyed(e, from, amount, token);
    }

    /// Whether every `CanTransfer` module accepts the move; true when none is
    /// registered.
    ///
    /// # Arguments
    ///
    /// * `from`, `to` - The two ends of the move.
    /// * `amount` - Share base units.
    /// * `token` - The token asking.
    ///
    /// # Errors
    ///
    /// * A module's own error.
    fn can_transfer(e: &Env, from: Address, to: Address, amount: i128, token: Address) -> bool {
        strata_storage::bump_instance(e);
        compliance::storage::can_transfer(e, from, to, amount, token)
    }

    /// Whether every `CanCreate` module accepts the mint; true when none is
    /// registered.
    ///
    /// # Arguments
    ///
    /// * `to` - The account to credit.
    /// * `amount` - Share base units.
    /// * `token` - The token asking.
    ///
    /// # Errors
    ///
    /// * A module's own error.
    fn can_create(e: &Env, to: Address, amount: i128, token: Address) -> bool {
        strata_storage::bump_instance(e);
        compliance::storage::can_create(e, to, amount, token)
    }
}

#[cfg(test)]
mod test;
