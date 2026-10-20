use soroban_sdk::{
    contracttype, panic_with_error, symbol_short, token::TokenClient, Address, BytesN, Env, Symbol,
    Vec,
};
use stellar_access::{
    access_control::{self, AccessControlClient, AccessControlStorageKey},
    role_transfer,
};
use stellar_contract_utils::{
    pausable::{self, PausableError},
    upgradeable,
};
use stellar_tokens::{
    fungible::FungibleTokenClient,
    rwa::{
        identity_verification::IdentityVerifierClient, utils::token_binder::TokenBinderClient,
        RWATokenClient,
    },
};
use strata_bindings::{OracleFeedClient, VaultBindingClient};
use strata_timelock::{queue, setup, Clock, Refusal};

use crate::error::VaultError;
use crate::event::{ChangeApplied, ChangeCancelled, ChangeProposed, NoticeSet, SetupFinished};
use crate::extend;
use crate::guards;
use crate::keys::DataKey;
use crate::state;
use crate::treasury;
use crate::upgrade;
use crate::wind_down;
use crate::AsyncVault;

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
    Oracle(Address),
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct VaultPendingChange {
    pub id: u32,
    pub change: VaultChange,
    pub eta: u64,
}

/// The share token's role that mints and burns. The vault must hold it alone.
const TOKEN_MANAGER_ROLE: Symbol = symbol_short!("manager");

/// What `finish_setup` needs to see before deposits open. `health()` reports
/// every check but `no_shares_outstanding`: a healthy vault has shares
/// outstanding from its first claim on.
pub(crate) struct Wiring {
    pub token_bound: bool,
    pub oracle_bound: bool,
    pub sole_token_manager: bool,
    /// Shares minted before setup would redeem against depositors' money.
    pub no_shares_outstanding: bool,
    pub allowlisted: bool,
    pub vault_unfrozen: bool,
    pub compliance_bound: bool,
    pub decimals_match: bool,
    pub addresses_distinct: bool,
    pub custodian_set: bool,
    pub feed_answers: bool,
}

impl Wiring {
    pub(crate) fn complete(&self) -> bool {
        self.token_bound
            && self.oracle_bound
            && self.sole_token_manager
            && self.no_shares_outstanding
            && self.allowlisted
            && self.vault_unfrozen
            && self.compliance_bound
            && self.decimals_match
            && self.addresses_distinct
            && self.custodian_set
            && self.feed_answers
    }
}

/// The clock this vault's queue runs on, and that it reports to the contracts
/// bound to it.
pub(crate) fn clock(e: &Env) -> Clock {
    Clock {
        delay: upgrade::delay(e),
        exit_window: state::notice(e),
        paused_secs: strata_timelock::pause::paused_secs(e),
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

/// True when `contract` reads this vault's clock and its own setup has
/// finished, so its admin changes wait for this timelock.
pub(crate) fn bound_here(e: &Env, contract: &Address) -> bool {
    let binding = VaultBindingClient::new(e, contract);
    matches!(binding.try_vault(), Ok(Ok(Some(vault))) if vault == e.current_contract_address())
        && matches!(binding.try_setup_open(), Ok(Ok(false)))
}

/// True when `feed` answers the views the vault prices from. A new feed has no
/// report yet, so this asks only for answers, not for a valid price.
pub(crate) fn answers_as_feed(e: &Env, feed: &Address) -> bool {
    let feed = OracleFeedClient::new(e, feed);
    matches!(feed.try_state(), Ok(Ok(_))) && matches!(feed.try_freshness_duration(), Ok(Ok(_)))
}

fn compliance_bound(e: &Env, compliance: &Address, token: &Address) -> bool {
    let linked = matches!(
        TokenBinderClient::new(e, compliance).try_linked_tokens(),
        Ok(Ok(linked)) if linked.contains(token)
    );
    let binding = VaultBindingClient::new(e, compliance);
    let on_this_clock = match (binding.try_vault(), binding.try_setup_open()) {
        (Ok(Ok(vault)), Ok(Ok(open))) => vault == Some(e.current_contract_address()) && !open,
        // An external module answers no binding view; its governance is a trust assumption.
        _ => true,
    };
    linked && on_this_clock
}

fn all_different(addresses: &[&Address]) -> bool {
    addresses
        .iter()
        .enumerate()
        .all(|(i, a)| addresses[i + 1..].iter().all(|b| a != b))
}

pub(crate) fn wiring(e: &Env) -> Wiring {
    let me = e.current_contract_address();
    let asset = state::get_addr(e, &DataKey::Asset);
    let token = state::get_addr(e, &DataKey::ShareToken);
    let oracle = state::get_addr(e, &DataKey::Oracle);
    let roles = AccessControlClient::new(e, &token);
    let rwa = RWATokenClient::new(e, &token);
    let shares = FungibleTokenClient::new(e, &token);
    Wiring {
        token_bound: bound_here(e, &token),
        oracle_bound: bound_here(e, &oracle),
        sole_token_manager: matches!(
            roles.try_get_role_member_count(&TOKEN_MANAGER_ROLE),
            Ok(Ok(1))
        ) && matches!(
            roles.try_get_role_member(&TOKEN_MANAGER_ROLE, &0),
            Ok(Ok(holder)) if holder == me
        ),
        no_shares_outstanding: matches!(shares.try_total_supply(), Ok(Ok(0))),
        allowlisted: match rwa.try_identity_verifier() {
            Ok(Ok(verifier)) => matches!(
                IdentityVerifierClient::new(e, &verifier).try_verify_identity(&me),
                Ok(Ok(()))
            ),
            _ => false,
        },
        vault_unfrozen: matches!(rwa.try_is_frozen(&me), Ok(Ok(false))),
        compliance_bound: match rwa.try_compliance() {
            Ok(Ok(compliance)) => compliance_bound(e, &compliance, &token),
            _ => false,
        },
        decimals_match: matches!(
            (TokenClient::new(e, &asset).try_decimals(), shares.try_decimals()),
            (Ok(Ok(of_asset)), Ok(Ok(of_shares))) if of_asset == of_shares
        ),
        addresses_distinct: all_different(&[&asset, &token, &oracle, &me]),
        custodian_set: state::get_addr_opt(e, &DataKey::Custodian)
            .is_some_and(|custodian| custodian != me),
        feed_answers: answers_as_feed(e, &oracle),
    }
}

pub(crate) fn finish_setup(e: &Env) {
    guards::setup_open(e);
    guards::no_hand_over_pending(e);
    guards::wiring_complete(e);
    setup::finish::<AsyncVault>(e).unwrap_or_else(|r| refuse(e, r));
    SetupFinished {}.publish(e);
}

pub(crate) fn set_notice(e: &Env, secs: u64) {
    state::set_notice(e, secs);
    NoticeSet { secs }.publish(e);
}

pub(crate) fn propose(e: &Env, change: VaultChange) -> u32 {
    guards::not_winding_down(e);
    guards::setup_finished(e);
    guards::valid_change(e, &change);
    guards::not_a_second_code_change(e, &change);
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
    guards::valid_change(e, &change);
    let admin = access_control::get_admin(e)
        .unwrap_or_else(|| panic_with_error!(e, VaultError::AdminRequired));
    match &change {
        VaultChange::Upgrade(hash) => upgradeable::upgrade(e, hash),
        VaultChange::UpgradeDelay(secs) => upgrade::set_delay(e, *secs),
        VaultChange::Custodian(custodian) => treasury::set_custodian(e, custodian),
        VaultChange::Notice(secs) => set_notice(e, *secs),
        VaultChange::WindDownDelay(secs) => wind_down::set_delay(e, *secs),
        VaultChange::GrantRole(role, account) => {
            access_control::grant_role_no_auth(e, account, role, &admin);
            extend::role_entries(e, account, role);
        }
        VaultChange::RevokeRole(role, account) => {
            access_control::revoke_role_no_auth(e, account, role, &admin)
        }
        VaultChange::Admin(next) => offer_admin(e, &admin, next),
        VaultChange::Oracle(feed) => state::set_addr(e, &DataKey::Oracle, feed),
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
