use soroban_sdk::{contracttype, panic_with_error, Address, BytesN, Env, Symbol, Vec};
use stellar_access::{
    access_control::{self, AccessControlStorageKey},
    role_transfer,
};
use stellar_contract_utils::upgradeable;
use stellar_tokens::rwa::RWA;
use timelock::{queue, setup, Clock, Refusal, TimelockHost};

use crate::error::ShareTokenError;
use crate::event::{ChangeApplied, ChangeCancelled, ChangeProposed, SetupFinished, VaultBound};
use crate::roles::MANAGER_ROLE;
use crate::ShareToken;

/// Seven days of five-second ledgers: how long the next admin has to accept a
/// hand-over.
pub const ADMIN_ACCEPT_LEDGERS: u32 = 7 * 17_280;

/// A privileged change that waits for the vault's timelock before it lands.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum TokenChange {
    Upgrade(BytesN<32>),
    GrantRole(Symbol, Address),
    RevokeRole(Symbol, Address),
    Admin(Address),
    Compliance(Address),
    IdentityVerifier(Address),
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct TokenPendingChange {
    pub id: u32,
    pub change: TokenChange,
    pub eta: u64,
}

/// The token keeps no clock of its own: it reads the vault's.
impl TimelockHost for ShareToken {
    fn clock(e: &Env) -> Result<Clock, Refusal> {
        timelock::clock::from_source(e)
    }
}

fn refuse(e: &Env, refusal: Refusal) -> ! {
    match refusal {
        Refusal::WindingDown => panic_with_error!(e, ShareTokenError::WindDownActive),
        Refusal::Paused => panic_with_error!(e, ShareTokenError::VaultPaused),
        Refusal::NotElapsed => panic_with_error!(e, ShareTokenError::ChangeNotReady),
        Refusal::BelowExitWindow => panic_with_error!(e, ShareTokenError::DelayBelowNotice),
        Refusal::NotFound => panic_with_error!(e, ShareTokenError::ChangeNotFound),
        Refusal::TooMany => panic_with_error!(e, ShareTokenError::TooManyPendingChanges),
        Refusal::SetupOpen => panic_with_error!(e, ShareTokenError::SetupOpen),
        Refusal::SetupClosed | Refusal::AlreadyBound => {
            panic_with_error!(e, ShareTokenError::SetupClosed)
        }
        Refusal::Unbound => panic_with_error!(e, ShareTokenError::VaultNotBound),
    }
}

fn vault_clock(e: &Env) -> Clock {
    <ShareToken as TimelockHost>::clock(e).unwrap_or_else(|r| refuse(e, r))
}

/// Direct admin calls are instant only before setup finishes.
pub(crate) fn require_setup_open(e: &Env) {
    if !setup::is_open(e) {
        panic_with_error!(e, ShareTokenError::UseTimelock);
    }
}

/// Taking `manager` away stops every claim, so after setup it waits like a
/// grant. Taking any other role away moves no value and stays instant.
pub(crate) fn require_revoke_allowed(e: &Env, role: &Symbol) {
    if *role == MANAGER_ROLE {
        require_setup_open(e);
    }
}

fn upgrade_pending(e: &Env) -> bool {
    queue::open_ids(e).iter().any(|id| {
        queue::pending::<TokenChange>(e, id)
            .is_some_and(|(change, _)| matches!(change, TokenChange::Upgrade(_)))
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
        panic_with_error!(e, ShareTokenError::AdminTransferPending);
    }
    setup::finish::<ShareToken>(e).unwrap_or_else(|r| refuse(e, r));
    SetupFinished {}.publish(e);
}

pub(crate) fn propose(e: &Env, change: TokenChange) -> u32 {
    if matches!(change, TokenChange::Upgrade(_)) && upgrade_pending(e) {
        panic_with_error!(e, ShareTokenError::UpgradeAlreadyPending);
    }
    let id = queue::propose::<ShareToken, _>(e, &change).unwrap_or_else(|r| refuse(e, r));
    let (_, schedule) =
        queue::pending::<TokenChange>(e, id).unwrap_or_else(|| refuse(e, Refusal::NotFound));
    ChangeProposed {
        id,
        change,
        eta: schedule.eta(&vault_clock(e)),
    }
    .publish(e);
    id
}

pub(crate) fn cancel(e: &Env, id: u32) {
    queue::cancel(e, id).unwrap_or_else(|r| refuse(e, r));
    ChangeCancelled { id }.publish(e);
}

pub(crate) fn apply(e: &Env, id: u32) {
    let change: TokenChange =
        queue::take_ready::<ShareToken, _>(e, id).unwrap_or_else(|r| refuse(e, r));
    let admin = access_control::get_admin(e)
        .unwrap_or_else(|| panic_with_error!(e, ShareTokenError::AdminRequired));
    match &change {
        TokenChange::Upgrade(hash) => upgradeable::upgrade(e, hash),
        TokenChange::GrantRole(role, account) => {
            access_control::grant_role_no_auth(e, account, role, &admin)
        }
        TokenChange::RevokeRole(role, account) => {
            access_control::revoke_role_no_auth(e, account, role, &admin)
        }
        TokenChange::Admin(next) => offer_admin(e, &admin, next),
        TokenChange::Compliance(rules) => RWA::set_compliance(e, rules),
        TokenChange::IdentityVerifier(verifier) => RWA::set_identity_verifier(e, verifier),
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
pub(crate) fn pending(e: &Env) -> Vec<TokenPendingChange> {
    let mut out = Vec::new(e);
    let open = queue::open_ids(e);
    if open.is_empty() {
        // Skips the vault, which is not bound yet during setup.
        return out;
    }
    let clock = vault_clock(e);
    for id in open.iter() {
        if let Some((change, schedule)) = queue::pending::<TokenChange>(e, id) {
            out.push_back(TokenPendingChange {
                id,
                change,
                eta: schedule.eta(&clock),
            });
        }
    }
    out
}
