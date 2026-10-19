//! Testnet-only stub — in production this is an external modular-compliance
//! module (ERC-3643), not part of this product. Do not deploy to mainnet.
#![no_std]

mod governance;

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

/// Compliance contract failures. Codes are stable once assigned and are never
/// reused; a removed variant leaves its number retired.
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
    pub fn __constructor(e: &Env, admin: Address) {
        access_control::set_admin(e, &admin);
        strata_storage::bump_instance(e);
    }

    /// Names the vault whose clock this contract's timelock reads. Once, and
    /// only during setup.
    #[only_admin]
    pub fn bind_vault(e: &Env, vault: Address, _operator: Address) {
        strata_storage::bump_instance(e);
        governance::bind_vault(e, &vault);
    }

    /// Ends the window in which module and binding changes are instant. It
    /// never reopens.
    #[only_admin]
    pub fn finish_setup(e: &Env, _operator: Address) {
        strata_storage::bump_instance(e);
        governance::finish_setup(e);
    }

    /// Queues a change behind the vault's timelock and returns its id.
    #[only_admin]
    pub fn propose_change(e: &Env, change: ComplianceChange, _operator: Address) -> u32 {
        strata_storage::bump_instance(e);
        governance::propose(e, change)
    }

    #[only_admin]
    pub fn cancel_change(e: &Env, id: u32, _operator: Address) {
        strata_storage::bump_instance(e);
        governance::cancel(e, id);
    }

    /// Lands a change whose delay has run. Refused while the vault is paused
    /// or winding down.
    #[only_admin]
    pub fn apply_change(e: &Env, id: u32, _operator: Address) {
        strata_storage::bump_instance(e);
        governance::apply(e, id);
    }

    pub fn pending_changes(e: &Env) -> Vec<CompliancePendingChange> {
        governance::pending(e)
    }

    /// Instant during setup; after it, propose an `Admin` change. Cancelling a
    /// pending hand-over (`live_until_ledger == 0`) keeps the current admin,
    /// so it stays instant.
    pub fn transfer_admin_role(e: &Env, new_admin: Address, live_until_ledger: u32) {
        if live_until_ledger != 0 {
            governance::require_setup_open(e);
        }
        strata_storage::bump_instance(e);
        access_control::transfer_admin_role(e, &new_admin, live_until_ledger);
    }

    pub fn accept_admin_transfer(e: &Env) {
        strata_storage::bump_instance(e);
        access_control::accept_admin_transfer(e);
    }

    pub fn get_admin(e: &Env) -> Option<Address> {
        access_control::get_admin(e)
    }
}

#[contractimpl(contracttrait)]
impl VaultBinding for Compliance {
    fn vault(e: &Env) -> Option<Address> {
        strata_timelock::setup::source(e)
    }

    fn setup_open(e: &Env) -> bool {
        strata_timelock::setup::is_open(e)
    }
}

/// Binding and unbinding are instant during setup; after it, propose a
/// `BindToken` or `UnbindToken` change.
#[contractimpl(contracttrait)]
impl token_binder::TokenBinder for Compliance {
    #[only_admin]
    fn bind_token(e: &Env, token: Address, _operator: Address) {
        governance::require_setup_open(e);
        strata_storage::bump_instance(e);
        token_binder::bind_token(e, &token);
    }

    #[only_admin]
    fn unbind_token(e: &Env, token: Address, _operator: Address) {
        governance::require_setup_open(e);
        strata_storage::bump_instance(e);
        token_binder::unbind_token(e, &token);
    }
}

/// The token calls the check before and the hook after every mint, burn and
/// transfer, which is what keeps this instance alive. Adding or removing a
/// module is instant during setup; after it, propose an `AddModule` or
/// `RemoveModule` change.
#[contractimpl(contracttrait)]
impl compliance::Compliance for Compliance {
    #[only_admin]
    fn add_module_to(e: &Env, hook: ComplianceHook, module: Address, _operator: Address) {
        governance::require_setup_open(e);
        strata_storage::bump_instance(e);
        compliance::storage::add_module_to(e, hook, module);
    }

    #[only_admin]
    fn remove_module_from(e: &Env, hook: ComplianceHook, module: Address, _operator: Address) {
        governance::require_setup_open(e);
        strata_storage::bump_instance(e);
        compliance::storage::remove_module_from(e, hook, module);
    }

    fn transferred(e: &Env, from: Address, to: Address, amount: i128, token: Address) {
        strata_storage::bump_instance(e);
        compliance::storage::transferred(e, from, to, amount, token);
    }

    fn created(e: &Env, to: Address, amount: i128, token: Address) {
        strata_storage::bump_instance(e);
        compliance::storage::created(e, to, amount, token);
    }

    fn destroyed(e: &Env, from: Address, amount: i128, token: Address) {
        strata_storage::bump_instance(e);
        compliance::storage::destroyed(e, from, amount, token);
    }

    fn can_transfer(e: &Env, from: Address, to: Address, amount: i128, token: Address) -> bool {
        strata_storage::bump_instance(e);
        compliance::storage::can_transfer(e, from, to, amount, token)
    }

    fn can_create(e: &Env, to: Address, amount: i128, token: Address) -> bool {
        strata_storage::bump_instance(e);
        compliance::storage::can_create(e, to, amount, token)
    }
}

#[cfg(test)]
mod test;
