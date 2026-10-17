use soroban_sdk::{contracttype, panic_with_error, Address, BytesN, Env, Symbol, Vec};
use stellar_access::{
    access_control::{self, AccessControlStorageKey},
    role_transfer,
};
use stellar_contract_utils::upgradeable;
use timelock::{queue, setup, Clock, Refusal, TimelockHost};

use crate::state::OracleConfig;
use crate::{
    store_config, validate_config, ChangeApplied, ChangeCancelled, ChangeProposed,
    NavOracleContract, OracleError, SetupFinished, VaultBound,
};

/// Seven days of five-second ledgers: how long the next admin has to accept a
/// hand-over.
pub const ADMIN_ACCEPT_LEDGERS: u32 = 7 * 17_280;

/// A privileged change that waits for the vault's timelock before it lands.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum OracleChange {
    Upgrade(BytesN<32>),
    GrantRole(Symbol, Address),
    RevokeRole(Symbol, Address),
    Admin(Address),
    Config(OracleConfig),
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct OraclePendingChange {
    pub id: u32,
    pub change: OracleChange,
    pub eta: u64,
}

/// True when `next` changes nothing but a shorter `freshness_duration`, or
/// nothing at all. A shorter window only lets reports go stale sooner: pricing
/// waits and cancellation reopens, so no value moves. Any other change can hold
/// the price away from the real value, a tighter cap included, so it waits.
pub fn shortens_freshness_only(current: &OracleConfig, next: &OracleConfig) -> bool {
    let rest_unchanged = *next
        == OracleConfig {
            freshness_duration: next.freshness_duration,
            ..current.clone()
        };
    rest_unchanged && next.freshness_duration <= current.freshness_duration
}

/// The oracle keeps no clock of its own: it reads the vault's.
impl TimelockHost for NavOracleContract {
    fn clock(e: &Env) -> Result<Clock, Refusal> {
        timelock::clock::from_source(e)
    }
}

fn refuse(e: &Env, refusal: Refusal) -> ! {
    match refusal {
        Refusal::WindingDown => panic_with_error!(e, OracleError::WindDownActive),
        Refusal::Paused => panic_with_error!(e, OracleError::VaultPaused),
        Refusal::NotElapsed => panic_with_error!(e, OracleError::ChangeNotReady),
        Refusal::BelowExitWindow => panic_with_error!(e, OracleError::DelayBelowNotice),
        Refusal::NotFound => panic_with_error!(e, OracleError::ChangeNotFound),
        Refusal::TooMany => panic_with_error!(e, OracleError::TooManyPendingChanges),
        Refusal::SetupOpen => panic_with_error!(e, OracleError::SetupOpen),
        Refusal::SetupClosed | Refusal::AlreadyBound => {
            panic_with_error!(e, OracleError::SetupClosed)
        }
        Refusal::Unbound => panic_with_error!(e, OracleError::VaultNotBound),
    }
}

fn vault_clock(e: &Env) -> Clock {
    <NavOracleContract as TimelockHost>::clock(e).unwrap_or_else(|r| refuse(e, r))
}

/// Direct admin calls are instant only before setup finishes.
pub(crate) fn require_setup_open(e: &Env) {
    if !setup::is_open(e) {
        panic_with_error!(e, OracleError::UseTimelock);
    }
}

fn upgrade_pending(e: &Env) -> bool {
    queue::open_ids(e).iter().any(|id| {
        queue::pending::<OracleChange>(e, id)
            .is_some_and(|(change, _)| matches!(change, OracleChange::Upgrade(_)))
    })
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
        panic_with_error!(e, OracleError::AdminTransferPending);
    }
    setup::finish::<NavOracleContract>(e).unwrap_or_else(|r| refuse(e, r));
    SetupFinished {}.publish(e);
}

pub(crate) fn propose(e: &Env, change: OracleChange) -> u32 {
    if let OracleChange::Config(config) = &change {
        validate_config(e, config);
    }
    if matches!(change, OracleChange::Upgrade(_)) && upgrade_pending(e) {
        panic_with_error!(e, OracleError::UpgradeAlreadyPending);
    }
    let id = queue::propose::<NavOracleContract, _>(e, &change).unwrap_or_else(|r| refuse(e, r));
    let (_, schedule) =
        queue::pending::<OracleChange>(e, id).unwrap_or_else(|| refuse(e, Refusal::NotFound));
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
    let change: OracleChange =
        queue::take_ready::<NavOracleContract, _>(e, id).unwrap_or_else(|r| refuse(e, r));
    let admin = access_control::get_admin(e)
        .unwrap_or_else(|| panic_with_error!(e, OracleError::AdminRequired));
    match &change {
        OracleChange::Upgrade(hash) => upgradeable::upgrade(e, hash),
        OracleChange::GrantRole(role, account) => {
            access_control::grant_role_no_auth(e, account, role, &admin)
        }
        OracleChange::RevokeRole(role, account) => {
            access_control::revoke_role_no_auth(e, account, role, &admin)
        }
        OracleChange::Admin(next) => offer_admin(e, &admin, next),
        OracleChange::Config(config) => {
            validate_config(e, config);
            store_config(e, config);
        }
    }
    ChangeApplied { id, change }.publish(e);
}

/// The first step of the two-step hand-over, without the admin authorisation
/// `transfer_admin_role` would ask for a second time inside `apply_change`.
fn offer_admin(e: &Env, admin: &Address, next: &Address) {
    let live_until = e.ledger().sequence().saturating_add(ADMIN_ACCEPT_LEDGERS);
    role_transfer::transfer_role(e, next, &AccessControlStorageKey::PendingAdmin, live_until);
    access_control::emit_admin_transfer_initiated(e, admin, next, live_until);
}

/// Every change still waiting, with the moment it may land on the vault's
/// clock as it reads now.
pub(crate) fn pending(e: &Env) -> Vec<OraclePendingChange> {
    let mut out = Vec::new(e);
    let open = queue::open_ids(e);
    if open.is_empty() {
        // Skips the vault, which is not bound yet during setup.
        return out;
    }
    let clock = vault_clock(e);
    for id in open.iter() {
        if let Some((change, schedule)) = queue::pending::<OracleChange>(e, id) {
            out.push_back(OraclePendingChange {
                id,
                change,
                eta: schedule.eta(&clock),
            });
        }
    }
    out
}
