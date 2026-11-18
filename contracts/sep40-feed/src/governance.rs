use soroban_sdk::{contracttype, panic_with_error, BytesN, Env, Vec};
use stellar_contract_utils::upgradeable;
use strata_timelock::{queue, Clock, Refusal, TimelockHost};

use crate::guards;
use crate::{ChangeApplied, ChangeCancelled, ChangeProposed, FeedError, Sep40Feed};

/// A privileged change that waits for the vault's timelock before it lands.
/// The feed stores no admin, so the only change it ever proposes is its own
/// upgrade.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum FeedChange {
    Upgrade(BytesN<32>),
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct FeedPendingChange {
    pub id: u32,
    pub change: FeedChange,
    pub eta: u64,
}

/// Maps a timelock refusal onto the feed's own error codes. `SetupOpen`,
/// `SetupClosed`, `AlreadyBound` and `Unbound` arise only in the constructor,
/// which binds the vault and closes setup before any other call can land.
pub(crate) fn refuse(e: &Env, refusal: Refusal) -> ! {
    match refusal {
        Refusal::WindingDown => panic_with_error!(e, FeedError::WindDownActive),
        Refusal::Paused => panic_with_error!(e, FeedError::VaultPaused),
        Refusal::NotElapsed => panic_with_error!(e, FeedError::ChangeNotReady),
        Refusal::BelowExitWindow => panic_with_error!(e, FeedError::DelayBelowNotice),
        Refusal::NotFound => panic_with_error!(e, FeedError::ChangeNotFound),
        Refusal::TooMany => panic_with_error!(e, FeedError::UpgradeAlreadyPending),
        Refusal::SetupOpen | Refusal::SetupClosed | Refusal::AlreadyBound | Refusal::Unbound => {
            panic_with_error!(e, FeedError::NotAVault)
        }
    }
}

fn vault_clock(e: &Env) -> Clock {
    <Sep40Feed as TimelockHost>::clock(e).unwrap_or_else(|r| refuse(e, r))
}

pub(crate) fn propose(e: &Env, change: FeedChange) -> u32 {
    guards::vault_not_winding_down(e);
    guards::no_upgrade_pending(e);
    let id = queue::propose::<Sep40Feed, _>(e, &change).unwrap_or_else(|r| refuse(e, r));
    let (_, schedule) =
        queue::pending::<FeedChange>(e, id).unwrap_or_else(|| refuse(e, Refusal::NotFound));
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
    let change: FeedChange =
        queue::take_ready::<Sep40Feed, _>(e, id).unwrap_or_else(|r| refuse(e, r));
    match &change {
        FeedChange::Upgrade(hash) => upgradeable::upgrade(e, hash),
    }
    ChangeApplied { id, change }.publish(e);
}

/// Every change still waiting, with the moment it may land on the vault's
/// clock as it reads now.
pub(crate) fn pending(e: &Env) -> Vec<FeedPendingChange> {
    let mut out = Vec::new(e);
    let open = queue::open_ids(e);
    if open.is_empty() {
        // Skips the vault's clock, which a failed read would turn into a
        // refusal even though nothing is waiting.
        return out;
    }
    let clock = vault_clock(e);
    for id in open.iter() {
        if let Some((change, schedule)) = queue::pending::<FeedChange>(e, id) {
            out.push_back(FeedPendingChange {
                id,
                change,
                eta: schedule.eta(&clock),
            });
        }
    }
    out
}
