use soroban_sdk::{contracttype, panic_with_error, BytesN, Env, Vec};
use stellar_contract_utils::{
    pausable::{self, PausableError},
    upgradeable,
};
use timelock::{queue, Clock, Refusal};

use crate::error::VaultError;
use crate::event::{ChangeApplied, ChangeCancelled, ChangeProposed};
use crate::state;
use crate::upgrade;
use crate::wind_down;
use crate::AsyncVault;

/// A privileged change that waits for the timelock before it lands.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum VaultChange {
    Upgrade(BytesN<32>),
    UpgradeDelay(u64),
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct VaultPendingChange {
    pub id: u32,
    pub change: VaultChange,
    pub eta: u64,
}

/// The clock this vault's queue runs on, and that it reports to the contracts
/// bound to it.
pub(crate) fn clock(e: &Env) -> Clock {
    Clock {
        delay: upgrade::delay(e),
        exit_window: state::notice(e),
        paused_secs: timelock::pause::paused_secs(e),
        paused: pausable::paused(e),
        winding_down: wind_down::is_active(e),
    }
}

pub(crate) fn refuse(e: &Env, refusal: Refusal) -> ! {
    match refusal {
        Refusal::WindingDown => panic_with_error!(e, VaultError::WindDownActive),
        Refusal::Paused => panic_with_error!(e, PausableError::EnforcedPause),
        Refusal::NotElapsed => panic_with_error!(e, VaultError::ChangeNotReady),
        Refusal::BelowExitWindow => panic_with_error!(e, VaultError::UpgradeDelayBelowNotice),
        Refusal::NotFound => panic_with_error!(e, VaultError::ChangeNotFound),
        Refusal::TooMany => panic_with_error!(e, VaultError::TooManyPendingChanges),
        // The constructor closes setup and binds nothing, so these mean a broken instance.
        Refusal::SetupOpen | Refusal::SetupClosed | Refusal::Unbound | Refusal::AlreadyBound => {
            panic_with_error!(e, VaultError::NotInitialized)
        }
    }
}

fn changes_code(change: &VaultChange) -> bool {
    matches!(
        change,
        VaultChange::Upgrade(_) | VaultChange::UpgradeDelay(_)
    )
}

/// One code change at a time, so a standing eta is never quietly replaced.
fn code_change_pending(e: &Env) -> bool {
    queue::open_ids(e).iter().any(|id| {
        queue::pending::<VaultChange>(e, id).is_some_and(|(change, _)| changes_code(&change))
    })
}

pub(crate) fn propose(e: &Env, change: VaultChange) -> u32 {
    wind_down::refuse_if_active(e);
    if let VaultChange::UpgradeDelay(secs) = change {
        upgrade::check_delay(e, secs);
    }
    if changes_code(&change) && code_change_pending(e) {
        panic_with_error!(e, VaultError::UpgradeProposalExists);
    }
    let id = queue::propose::<AsyncVault, _>(e, &change).unwrap_or_else(|r| refuse(e, r));
    ChangeProposed {
        id,
        change,
        eta: e.ledger().timestamp().saturating_add(upgrade::delay(e)),
    }
    .publish(e);
    id
}

pub(crate) fn cancel(e: &Env, id: u32) {
    queue::cancel(e, id).unwrap_or_else(|r| refuse(e, r));
    ChangeCancelled { id }.publish(e);
}

pub(crate) fn apply(e: &Env, id: u32) {
    let change: VaultChange =
        queue::take_ready::<AsyncVault, _>(e, id).unwrap_or_else(|r| refuse(e, r));
    match &change {
        VaultChange::UpgradeDelay(secs) => {
            // The notice may have moved since the proposal; this check decides.
            upgrade::check_delay(e, *secs);
            upgrade::set_delay(e, *secs);
        }
        VaultChange::Upgrade(hash) => upgradeable::upgrade(e, hash),
    }
    ChangeApplied { id, change }.publish(e);
}

pub(crate) fn pending(e: &Env) -> Vec<VaultPendingChange> {
    let clock = clock(e);
    let mut out = Vec::new(e);
    for id in queue::open_ids(e).iter() {
        if let Some((change, schedule)) = queue::pending::<VaultChange>(e, id) {
            out.push_back(VaultPendingChange {
                id,
                change,
                eta: schedule.eta(&clock),
            });
        }
    }
    out
}
