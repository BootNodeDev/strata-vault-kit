use soroban_sdk::{contracttype, panic_with_error, Address, BytesN, Env, Vec};
use stellar_access::{
    access_control::{self, AccessControlError, AccessControlStorageKey},
    role_transfer,
};
use strata_timelock::{queue, setup, Clock, Refusal, TimelockHost};

use crate::guards;
use crate::{
    ChangeApplied, ChangeCancelled, ChangeProposed, IdentityRegistry, IdentityRegistryError,
    SetupFinished, VaultBound, VerifierBound,
};

/// Seven days of five-second ledgers: how long the next admin has to accept a
/// hand-over.
pub const ADMIN_ACCEPT_LEDGERS: u32 = 7 * 17_280;

/// A privileged change that waits for the vault's timelock before it lands.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum RegistryChange {
    IdentityWasm(BytesN<32>),
    Verifier(Address),
    Compliance(Address),
    Admin(Address),
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RegistryPendingChange {
    pub id: u32,
    pub change: RegistryChange,
    pub eta: u64,
}

#[contracttype]
enum DataKey {
    IdentityWasm,
    Compliance,
    Verifier,
}

/// The registry keeps no clock of its own: it reads the vault's.
impl TimelockHost for IdentityRegistry {
    fn clock(e: &Env) -> Result<Clock, Refusal> {
        strata_timelock::clock::from_source(e)
    }
}

fn refuse(e: &Env, refusal: Refusal) -> ! {
    match refusal {
        Refusal::WindingDown => panic_with_error!(e, IdentityRegistryError::WindDownActive),
        Refusal::Paused => panic_with_error!(e, IdentityRegistryError::VaultPaused),
        Refusal::NotElapsed => panic_with_error!(e, IdentityRegistryError::ChangeNotReady),
        Refusal::BelowExitWindow => {
            panic_with_error!(e, IdentityRegistryError::DelayBelowNotice)
        }
        Refusal::NotFound => panic_with_error!(e, IdentityRegistryError::ChangeNotFound),
        Refusal::TooMany => panic_with_error!(e, IdentityRegistryError::TooManyPendingChanges),
        Refusal::SetupOpen => panic_with_error!(e, IdentityRegistryError::SetupOpen),
        Refusal::SetupClosed | Refusal::AlreadyBound => {
            panic_with_error!(e, IdentityRegistryError::SetupClosed)
        }
        Refusal::Unbound => panic_with_error!(e, IdentityRegistryError::VaultNotBound),
    }
}

fn vault_clock(e: &Env) -> Clock {
    <IdentityRegistry as TimelockHost>::clock(e).unwrap_or_else(|r| refuse(e, r))
}

pub(crate) fn set_identity_wasm(e: &Env, wasm: &BytesN<32>) {
    strata_storage::set_instance(e, &DataKey::IdentityWasm, wasm);
}

pub(crate) fn identity_wasm(e: &Env) -> BytesN<32> {
    strata_storage::get_instance(e, &DataKey::IdentityWasm)
        .unwrap_or_else(|| panic_with_error!(e, IdentityRegistryError::NotInitialized))
}

pub(crate) fn set_compliance(e: &Env, compliance: &Address) {
    strata_storage::set_instance(e, &DataKey::Compliance, compliance);
}

pub(crate) fn compliance(e: &Env) -> Address {
    strata_storage::get_instance(e, &DataKey::Compliance)
        .unwrap_or_else(|| panic_with_error!(e, IdentityRegistryError::NotInitialized))
}

fn set_verifier(e: &Env, verifier: &Address) {
    strata_storage::set_instance(e, &DataKey::Verifier, verifier);
}

pub(crate) fn verifier(e: &Env) -> Address {
    strata_storage::get_instance(e, &DataKey::Verifier)
        .unwrap_or_else(|| panic_with_error!(e, IdentityRegistryError::VerifierNotBound))
}

pub(crate) fn has_verifier(e: &Env) -> bool {
    e.storage().instance().has(&DataKey::Verifier)
}

pub(crate) fn bind_vault(e: &Env, vault: &Address) {
    setup::bind_source(e, vault).unwrap_or_else(|r| refuse(e, r));
    VaultBound {
        vault: vault.clone(),
    }
    .publish(e);
}

pub(crate) fn bind_verifier(e: &Env, verifier: &Address) {
    set_verifier(e, verifier);
    VerifierBound {
        verifier: verifier.clone(),
    }
    .publish(e);
}

pub(crate) fn finish_setup(e: &Env) {
    guards::setup_open(e);
    guards::no_hand_over_pending(e);
    guards::verifier_bound(e);
    setup::finish::<IdentityRegistry>(e).unwrap_or_else(|r| refuse(e, r));
    SetupFinished {}.publish(e);
}

pub(crate) fn propose(e: &Env, change: RegistryChange) -> u32 {
    let id = queue::propose::<IdentityRegistry, _>(e, &change).unwrap_or_else(|r| refuse(e, r));
    let (_, schedule) =
        queue::pending::<RegistryChange>(e, id).unwrap_or_else(|| refuse(e, Refusal::NotFound));
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
    let change = queue::take_ready::<IdentityRegistry, RegistryChange>(e, id)
        .unwrap_or_else(|r| refuse(e, r));
    match &change {
        RegistryChange::IdentityWasm(wasm) => set_identity_wasm(e, wasm),
        RegistryChange::Verifier(verifier) => set_verifier(e, verifier),
        RegistryChange::Compliance(compliance) => set_compliance(e, compliance),
        RegistryChange::Admin(next) => offer_admin(e, next),
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
pub(crate) fn pending(e: &Env) -> Vec<RegistryPendingChange> {
    let mut out = Vec::new(e);
    let open = queue::open_ids(e);
    if open.is_empty() {
        // Skips the vault, which is not bound yet during setup.
        return out;
    }
    let clock = vault_clock(e);
    for id in open.iter() {
        if let Some((change, schedule)) = queue::pending::<RegistryChange>(e, id) {
            out.push_back(RegistryPendingChange {
                id,
                change,
                eta: schedule.eta(&clock),
            });
        }
    }
    out
}
