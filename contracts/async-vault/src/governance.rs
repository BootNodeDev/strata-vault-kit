use bindings::VaultBindingClient;
use soroban_sdk::{contracttype, panic_with_error, Address, BytesN, Env, Symbol, Vec};
use stellar_access::{
    access_control::{self, AccessControlClient, AccessControlStorageKey},
    role_transfer,
};
use stellar_contract_utils::{
    pausable::{self, PausableError},
    upgradeable,
};
use stellar_tokens::rwa::{
    identity_verification::IdentityVerifierClient, utils::token_binder::TokenBinderClient,
    RWATokenClient,
};
use timelock::{queue, setup, Clock, Refusal};

use crate::error::VaultError;
use crate::event::{ChangeApplied, ChangeCancelled, ChangeProposed, NoticeSet, SetupFinished};
use crate::keys::DataKey;
use crate::roles::MANAGER_ROLE;
use crate::state;
use crate::treasury;
use crate::upgrade;
use crate::wind_down;
use crate::{AsyncVault, MAX_NOTICE_SECS};

/// Seven days of five-second ledgers: how long the next admin has to accept a
/// hand-over.
pub const ADMIN_ACCEPT_LEDGERS: u32 = 7 * 17_280;

/// A privileged change that waits for the timelock before it lands.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum VaultChange {
    Upgrade(BytesN<32>),
    UpgradeDelay(u64),
    Custodian(Address),
    Notice(u64),
    WindDownDelay(u64),
    GrantRole(Symbol, Address),
    RevokeRole(Symbol, Address),
    Admin(Address),
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct VaultPendingChange {
    pub id: u32,
    pub change: VaultChange,
    pub eta: u64,
}

/// What `finish_setup` needs to see before deposits open.
pub(crate) struct Wiring {
    pub token_bound: bool,
    pub oracle_bound: bool,
    pub sole_token_manager: bool,
    pub allowlisted: bool,
    pub compliance_bound: bool,
}

impl Wiring {
    fn complete(&self) -> bool {
        self.token_bound
            && self.oracle_bound
            && self.sole_token_manager
            && self.allowlisted
            && self.compliance_bound
    }
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

fn refuse(e: &Env, refusal: Refusal) -> ! {
    match refusal {
        Refusal::WindingDown => panic_with_error!(e, VaultError::WindDownActive),
        Refusal::Paused => panic_with_error!(e, PausableError::EnforcedPause),
        Refusal::NotElapsed => panic_with_error!(e, VaultError::ChangeNotReady),
        Refusal::BelowExitWindow => panic_with_error!(e, VaultError::UpgradeDelayBelowNotice),
        Refusal::NotFound => panic_with_error!(e, VaultError::ChangeNotFound),
        Refusal::TooMany => panic_with_error!(e, VaultError::TooManyPendingChanges),
        Refusal::SetupOpen => panic_with_error!(e, VaultError::SetupOpen),
        Refusal::SetupClosed => panic_with_error!(e, VaultError::SetupClosed),
        // The vault owns the clock and binds to nothing, so these two never arise.
        Refusal::AlreadyBound => panic_with_error!(e, VaultError::SetupClosed),
        Refusal::Unbound => panic_with_error!(e, VaultError::SetupIncomplete),
    }
}

/// Direct admin calls are instant only before setup finishes.
pub(crate) fn require_setup_open(e: &Env) {
    if !setup::is_open(e) {
        panic_with_error!(e, VaultError::UseTimelock);
    }
}

/// Nothing is taken in or queued until every admin change on the kit waits for
/// the timelock.
pub(crate) fn refuse_if_setup_open(e: &Env) {
    if setup::is_open(e) {
        panic_with_error!(e, VaultError::SetupOpen);
    }
}

/// After setup, revoking `manager` waits like a grant; any other revoke stays
/// instant.
pub(crate) fn require_revoke_allowed(e: &Env, role: &Symbol) {
    if *role == MANAGER_ROLE {
        require_setup_open(e);
    }
}

/// True when `contract` reads this vault's clock and its own setup has
/// finished, so its admin changes wait for this timelock.
pub(crate) fn bound_here(e: &Env, contract: &Address) -> bool {
    let binding = VaultBindingClient::new(e, contract);
    matches!(binding.try_vault(), Ok(Ok(Some(vault))) if vault == e.current_contract_address())
        && matches!(binding.try_setup_open(), Ok(Ok(false)))
}

pub(crate) fn wiring(e: &Env) -> Wiring {
    let me = e.current_contract_address();
    let token = state::get_addr(e, &DataKey::ShareToken);
    let oracle = state::get_addr(e, &DataKey::Oracle);
    let roles = AccessControlClient::new(e, &token);
    let rwa = RWATokenClient::new(e, &token);
    Wiring {
        token_bound: bound_here(e, &token),
        oracle_bound: bound_here(e, &oracle),
        sole_token_manager: roles.get_role_member_count(&MANAGER_ROLE) == 1
            && roles.get_role_member(&MANAGER_ROLE, &0) == me,
        allowlisted: matches!(
            IdentityVerifierClient::new(e, &rwa.identity_verifier()).try_verify_identity(&me),
            Ok(Ok(()))
        ),
        compliance_bound: matches!(
            TokenBinderClient::new(e, &rwa.compliance()).try_linked_tokens(),
            Ok(Ok(linked)) if linked.contains(&token)
        ),
    }
}

/// No nominee from setup may accept once changes wait, so a hand-over offered
/// during setup holds it open.
pub(crate) fn finish_setup(e: &Env) {
    if !setup::is_open(e) {
        panic_with_error!(e, VaultError::SetupClosed);
    }
    if role_transfer::has_active_pending_transfer(e, &AccessControlStorageKey::PendingAdmin) {
        panic_with_error!(e, VaultError::AdminTransferPending);
    }
    if !wiring(e).complete() {
        panic_with_error!(e, VaultError::SetupIncomplete);
    }
    setup::finish::<AsyncVault>(e).unwrap_or_else(|r| refuse(e, r));
    SetupFinished {}.publish(e);
}

fn check_notice(e: &Env, secs: u64) {
    if secs > MAX_NOTICE_SECS {
        panic_with_error!(e, VaultError::NoticeTooLong);
    }
    if secs > upgrade::delay(e) {
        panic_with_error!(e, VaultError::NoticeAboveUpgradeDelay);
    }
}

pub(crate) fn set_notice(e: &Env, secs: u64) {
    check_notice(e, secs);
    state::set_notice(e, secs);
    NoticeSet { secs }.publish(e);
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

/// The bounds a change must meet when it is proposed and again when it
/// applies.
fn check(e: &Env, change: &VaultChange) {
    match change {
        VaultChange::UpgradeDelay(secs) => upgrade::check_delay(e, *secs),
        VaultChange::Notice(secs) => check_notice(e, *secs),
        VaultChange::WindDownDelay(secs) => wind_down::check_delay(e, *secs),
        VaultChange::Upgrade(_)
        | VaultChange::Custodian(_)
        | VaultChange::GrantRole(..)
        | VaultChange::RevokeRole(..)
        | VaultChange::Admin(_) => {}
    }
}

pub(crate) fn propose(e: &Env, change: VaultChange) -> u32 {
    wind_down::refuse_if_active(e);
    refuse_if_setup_open(e);
    check(e, &change);
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
    // The notice or the delay may have moved since the proposal; this check decides.
    check(e, &change);
    let admin = access_control::get_admin(e)
        .unwrap_or_else(|| panic_with_error!(e, VaultError::AdminRequired));
    match &change {
        VaultChange::Upgrade(hash) => upgradeable::upgrade(e, hash),
        VaultChange::UpgradeDelay(secs) => upgrade::set_delay(e, *secs),
        VaultChange::Custodian(custodian) => treasury::set_custodian(e, custodian),
        VaultChange::Notice(secs) => set_notice(e, *secs),
        VaultChange::WindDownDelay(secs) => wind_down::set_delay(e, *secs),
        VaultChange::GrantRole(role, account) => {
            access_control::grant_role_no_auth(e, account, role, &admin)
        }
        VaultChange::RevokeRole(role, account) => {
            access_control::revoke_role_no_auth(e, account, role, &admin)
        }
        VaultChange::Admin(next) => offer_admin(e, &admin, next),
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
