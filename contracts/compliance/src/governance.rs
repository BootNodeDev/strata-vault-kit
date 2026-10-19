use soroban_sdk::{contracttype, panic_with_error, Address, Env, Vec};
use stellar_access::{
    access_control::{self, AccessControlError, AccessControlStorageKey},
    role_transfer,
};
use stellar_tokens::rwa::{compliance, compliance::ComplianceHook, utils::token_binder};
use strata_timelock::{queue, setup, Clock, Refusal, TimelockHost};

use crate::{
    ChangeApplied, ChangeCancelled, ChangeProposed, Compliance, ComplianceContractError,
    SetupFinished, VaultBound,
};

/// Seven days of five-second ledgers: how long the next admin has to accept a
/// hand-over.
pub const ADMIN_ACCEPT_LEDGERS: u32 = 7 * 17_280;

/// A privileged change that waits for the vault's timelock before it lands.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum ComplianceChange {
    AddModule(ComplianceHook, Address),
    RemoveModule(ComplianceHook, Address),
    BindToken(Address),
    UnbindToken(Address),
    Admin(Address),
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CompliancePendingChange {
    pub id: u32,
    pub change: ComplianceChange,
    pub eta: u64,
}

/// The compliance contract keeps no clock of its own: it reads the vault's.
impl TimelockHost for Compliance {
    fn clock(e: &Env) -> Result<Clock, Refusal> {
        strata_timelock::clock::from_source(e)
    }
}

fn refuse(e: &Env, refusal: Refusal) -> ! {
    match refusal {
        Refusal::WindingDown => panic_with_error!(e, ComplianceContractError::WindDownActive),
        Refusal::Paused => panic_with_error!(e, ComplianceContractError::VaultPaused),
        Refusal::NotElapsed => panic_with_error!(e, ComplianceContractError::ChangeNotReady),
        Refusal::BelowExitWindow => {
            panic_with_error!(e, ComplianceContractError::DelayBelowNotice)
        }
        Refusal::NotFound => panic_with_error!(e, ComplianceContractError::ChangeNotFound),
        Refusal::TooMany => panic_with_error!(e, ComplianceContractError::TooManyPendingChanges),
        Refusal::SetupOpen => panic_with_error!(e, ComplianceContractError::SetupOpen),
        Refusal::SetupClosed | Refusal::AlreadyBound => {
            panic_with_error!(e, ComplianceContractError::SetupClosed)
        }
        Refusal::Unbound => panic_with_error!(e, ComplianceContractError::VaultNotBound),
    }
}

fn vault_clock(e: &Env) -> Clock {
    <Compliance as TimelockHost>::clock(e).unwrap_or_else(|r| refuse(e, r))
}

/// Direct rule changes are instant only before setup finishes.
pub(crate) fn require_setup_open(e: &Env) {
    if !setup::is_open(e) {
        panic_with_error!(e, ComplianceContractError::UseTimelock);
    }
}

pub(crate) fn bind_vault(e: &Env, vault: &Address) {
    setup::bind_source(e, vault).unwrap_or_else(|r| refuse(e, r));
    VaultBound {
        vault: vault.clone(),
    }
    .publish(e);
}

/// No nominee from setup may accept once changes wait, so a hand-over offered
/// during setup holds it open.
pub(crate) fn finish_setup(e: &Env) {
    if setup::is_open(e)
        && role_transfer::has_active_pending_transfer(e, &AccessControlStorageKey::PendingAdmin)
    {
        panic_with_error!(e, ComplianceContractError::AdminTransferPending);
    }
    setup::finish::<Compliance>(e).unwrap_or_else(|r| refuse(e, r));
    SetupFinished {}.publish(e);
}

pub(crate) fn propose(e: &Env, change: ComplianceChange) -> u32 {
    let id = queue::propose::<Compliance, _>(e, &change).unwrap_or_else(|r| refuse(e, r));
    let (_, schedule) =
        queue::pending::<ComplianceChange>(e, id).unwrap_or_else(|| refuse(e, Refusal::NotFound));
    // No pause has run since the proposal, so the eta needs no second clock read.
    ChangeProposed {
        id,
        change,
        eta: schedule.proposed_at.saturating_add(schedule.delay),
    }
    .publish(e);
    id
}

pub(crate) fn cancel(e: &Env, id: u32) {
    queue::cancel(e, id).unwrap_or_else(|r| refuse(e, r));
    ChangeCancelled { id }.publish(e);
}

pub(crate) fn apply(e: &Env, id: u32) {
    let change: ComplianceChange =
        queue::take_ready::<Compliance, _>(e, id).unwrap_or_else(|r| refuse(e, r));
    match &change {
        ComplianceChange::AddModule(hook, module) => {
            compliance::storage::add_module_to(e, hook.clone(), module.clone())
        }
        ComplianceChange::RemoveModule(hook, module) => {
            compliance::storage::remove_module_from(e, hook.clone(), module.clone())
        }
        ComplianceChange::BindToken(token) => token_binder::bind_token(e, token),
        ComplianceChange::UnbindToken(token) => token_binder::unbind_token(e, token),
        ComplianceChange::Admin(next) => offer_admin(e, next),
    }
    ChangeApplied { id, change }.publish(e);
}

/// The first step of the two-step hand-over, without the admin authorisation
/// `transfer_admin_role` would ask for a second time inside `apply_change`.
fn offer_admin(e: &Env, next: &Address) {
    let admin = access_control::get_admin(e)
        .unwrap_or_else(|| panic_with_error!(e, AccessControlError::AdminNotSet));
    let live_until = e.ledger().sequence().saturating_add(ADMIN_ACCEPT_LEDGERS);
    role_transfer::transfer_role(e, next, &AccessControlStorageKey::PendingAdmin, live_until);
    access_control::emit_admin_transfer_initiated(e, &admin, next, live_until);
}

/// Every change still waiting, with the moment it may land on the vault's
/// clock as it reads now.
pub(crate) fn pending(e: &Env) -> Vec<CompliancePendingChange> {
    let mut out = Vec::new(e);
    let open = queue::open_ids(e);
    if open.is_empty() {
        // Skips the vault, which is not bound yet during setup.
        return out;
    }
    let clock = vault_clock(e);
    for id in open.iter() {
        if let Some((change, schedule)) = queue::pending::<ComplianceChange>(e, id) {
            out.push_back(CompliancePendingChange {
                id,
                change,
                eta: schedule.eta(&clock),
            });
        }
    }
    out
}
