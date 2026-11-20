use soroban_sdk::{contracttype, panic_with_error, Address, Env, Vec};
use stellar_access::{
    access_control::{self, AccessControlError, AccessControlStorageKey},
    role_transfer,
};
use stellar_tokens::rwa::identity_verification::storage;
use strata_timelock::{queue, setup, Clock, Refusal, TimelockHost};

use crate::{guards, protocol};
use crate::{
    ChangeApplied, ChangeCancelled, ChangeProposed, IdentityVerifier, SetupFinished, VaultBound,
    VerifierError,
};

/// Seven days of five-second ledgers: how long the next admin has to accept a
/// hand-over.
pub const ADMIN_ACCEPT_LEDGERS: u32 = 7 * 17_280;

/// A privileged change that waits for the vault's timelock before it lands.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum VerifierChange {
    AddProtocolAddress(Address),
    RemoveProtocolAddress(Address),
    Registry(Address),
    Topics(Address),
    Admin(Address),
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct VerifierPendingChange {
    pub id: u32,
    pub change: VerifierChange,
    pub eta: u64,
}

/// The verifier keeps no clock of its own: it reads the vault's.
impl TimelockHost for IdentityVerifier {
    fn clock(e: &Env) -> Result<Clock, Refusal> {
        strata_timelock::clock::from_source(e)
    }
}

/// The vault's clock with its wind-down ignored, so removing a protocol
/// address still lands after the normal delay.
struct RemovalHost;

impl TimelockHost for RemovalHost {
    fn clock(e: &Env) -> Result<Clock, Refusal> {
        let mut clock = <IdentityVerifier as TimelockHost>::clock(e)?;
        clock.winding_down = false;
        Ok(clock)
    }
}

fn is_removal(change: &VerifierChange) -> bool {
    matches!(change, VerifierChange::RemoveProtocolAddress(..))
}

fn refuse(e: &Env, refusal: Refusal) -> ! {
    match refusal {
        Refusal::WindingDown => panic_with_error!(e, VerifierError::WindDownActive),
        Refusal::Paused => panic_with_error!(e, VerifierError::VaultPaused),
        Refusal::NotElapsed => panic_with_error!(e, VerifierError::ChangeNotReady),
        Refusal::BelowExitWindow => panic_with_error!(e, VerifierError::DelayBelowNotice),
        Refusal::NotFound => panic_with_error!(e, VerifierError::ChangeNotFound),
        Refusal::TooMany => panic_with_error!(e, VerifierError::TooManyPendingChanges),
        Refusal::SetupOpen => panic_with_error!(e, VerifierError::SetupOpen),
        Refusal::SetupClosed | Refusal::AlreadyBound => {
            panic_with_error!(e, VerifierError::SetupClosed)
        }
        Refusal::Unbound => panic_with_error!(e, VerifierError::VaultNotBound),
    }
}

fn vault_clock(e: &Env) -> Clock {
    <IdentityVerifier as TimelockHost>::clock(e).unwrap_or_else(|r| refuse(e, r))
}

pub(crate) fn bind_vault(e: &Env, vault: &Address) {
    let was_protocol = protocol::is_protocol(e, vault);
    setup::bind_source(e, vault).unwrap_or_else(|r| refuse(e, r));
    VaultBound {
        vault: vault.clone(),
    }
    .publish(e);
    if !was_protocol {
        protocol::publish_added(e, vault);
    }
}

pub(crate) fn finish_setup(e: &Env) {
    guards::setup_open(e);
    guards::no_hand_over_pending(e);
    setup::finish::<IdentityVerifier>(e).unwrap_or_else(|r| refuse(e, r));
    SetupFinished {}.publish(e);
}

pub(crate) fn propose(e: &Env, change: VerifierChange) -> u32 {
    // The vault is bound during setup and never changes, so checking here is enough.
    if let VerifierChange::RemoveProtocolAddress(account) = &change {
        guards::not_the_vault(e, account);
    }
    let queued = if is_removal(&change) {
        queue::propose::<RemovalHost, _>(e, &change)
    } else {
        queue::propose::<IdentityVerifier, _>(e, &change)
    };
    let id = queued.unwrap_or_else(|r| refuse(e, r));
    let (_, schedule) =
        queue::pending::<VerifierChange>(e, id).unwrap_or_else(|| refuse(e, Refusal::NotFound));
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
    let (waiting, _) =
        queue::pending::<VerifierChange>(e, id).unwrap_or_else(|| refuse(e, Refusal::NotFound));
    let ready = if is_removal(&waiting) {
        queue::take_ready::<RemovalHost, VerifierChange>(e, id)
    } else {
        queue::take_ready::<IdentityVerifier, VerifierChange>(e, id)
    };
    let change = ready.unwrap_or_else(|r| refuse(e, r));
    match &change {
        VerifierChange::AddProtocolAddress(account) => protocol::add(e, account),
        VerifierChange::RemoveProtocolAddress(account) => protocol::remove(e, account),
        VerifierChange::Registry(registry) => storage::set_identity_registry_storage(e, registry),
        VerifierChange::Topics(topics) => storage::set_claim_topics_and_issuers(e, topics),
        VerifierChange::Admin(next) => offer_admin(e, next),
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
pub(crate) fn pending(e: &Env) -> Vec<VerifierPendingChange> {
    let mut out = Vec::new(e);
    let open = queue::open_ids(e);
    if open.is_empty() {
        // Skips the vault, which is not bound yet during setup.
        return out;
    }
    let clock = vault_clock(e);
    for id in open.iter() {
        if let Some((change, schedule)) = queue::pending::<VerifierChange>(e, id) {
            out.push_back(VerifierPendingChange {
                id,
                change,
                eta: schedule.eta(&clock),
            });
        }
    }
    out
}
