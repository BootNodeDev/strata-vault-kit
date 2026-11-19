use soroban_sdk::{contracttype, panic_with_error, Address, BytesN, Env, Vec};
use stellar_access::{
    access_control::{self, AccessControlError, AccessControlStorageKey},
    role_transfer,
};
use stellar_tokens::rwa::identity_verification::claim_topics_and_issuers::storage;
use strata_timelock::{queue, setup, Clock, Refusal, TimelockHost};

use crate::extend;
use crate::guards;
use crate::{
    ChangeApplied, ChangeCancelled, ChangeProposed, ClaimTopics, ClaimTopicsContractError,
    SetupFinished, VaultBound,
};

/// Seven days of five-second ledgers: how long the next admin has to accept a
/// hand-over.
pub const ADMIN_ACCEPT_LEDGERS: u32 = 7 * 17_280;

/// A privileged change that waits for the vault's timelock before it lands.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum TopicsChange {
    AddClaimTopic(u32),
    RemoveClaimTopic(u32),
    AddTrustedIssuer(Address, Vec<u32>),
    RemoveTrustedIssuer(Address),
    UpdateIssuerTopics(Address, Vec<u32>),
    IssuerWasm(BytesN<32>),
    Admin(Address),
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct TopicsPendingChange {
    pub id: u32,
    pub change: TopicsChange,
    pub eta: u64,
}

#[contracttype]
enum DataKey {
    IssuerWasm,
}

/// The topics contract keeps no clock of its own: it reads the vault's.
impl TimelockHost for ClaimTopics {
    fn clock(e: &Env) -> Result<Clock, Refusal> {
        strata_timelock::clock::from_source(e)
    }
}

/// The vault's clock with its wind-down ignored, so removing a topic or an
/// issuer still lands after the normal delay: left in place, a failing issuer
/// would hold every identity check it answers.
struct RemovalHost;

impl TimelockHost for RemovalHost {
    fn clock(e: &Env) -> Result<Clock, Refusal> {
        let mut clock = <ClaimTopics as TimelockHost>::clock(e)?;
        clock.winding_down = false;
        Ok(clock)
    }
}

fn is_removal(change: &TopicsChange) -> bool {
    matches!(
        change,
        TopicsChange::RemoveClaimTopic(..) | TopicsChange::RemoveTrustedIssuer(..)
    )
}

fn refuse(e: &Env, refusal: Refusal) -> ! {
    match refusal {
        Refusal::WindingDown => panic_with_error!(e, ClaimTopicsContractError::WindDownActive),
        Refusal::Paused => panic_with_error!(e, ClaimTopicsContractError::VaultPaused),
        Refusal::NotElapsed => panic_with_error!(e, ClaimTopicsContractError::ChangeNotReady),
        Refusal::BelowExitWindow => {
            panic_with_error!(e, ClaimTopicsContractError::DelayBelowNotice)
        }
        Refusal::NotFound => panic_with_error!(e, ClaimTopicsContractError::ChangeNotFound),
        Refusal::TooMany => {
            panic_with_error!(e, ClaimTopicsContractError::TooManyPendingChanges)
        }
        Refusal::SetupOpen => panic_with_error!(e, ClaimTopicsContractError::SetupOpen),
        Refusal::SetupClosed | Refusal::AlreadyBound => {
            panic_with_error!(e, ClaimTopicsContractError::SetupClosed)
        }
        Refusal::Unbound => panic_with_error!(e, ClaimTopicsContractError::VaultNotBound),
    }
}

fn vault_clock(e: &Env) -> Clock {
    <ClaimTopics as TimelockHost>::clock(e).unwrap_or_else(|r| refuse(e, r))
}

pub(crate) fn set_issuer_wasm(e: &Env, wasm: &BytesN<32>) {
    strata_storage::set_instance(e, &DataKey::IssuerWasm, wasm);
}

pub(crate) fn issuer_wasm(e: &Env) -> BytesN<32> {
    strata_storage::get_instance(e, &DataKey::IssuerWasm)
        .unwrap_or_else(|| panic_with_error!(e, ClaimTopicsContractError::NotInitialized))
}

pub(crate) fn add_topic(e: &Env, topic: u32) {
    storage::add_claim_topic(e, topic);
    extend::topic(e, topic);
}

pub(crate) fn add_issuer(e: &Env, issuer: &Address, topics: &Vec<u32>) {
    storage::add_trusted_issuer(e, issuer, topics);
    extend::issuer(e, issuer);
}

pub(crate) fn bind_vault(e: &Env, vault: &Address) {
    setup::bind_source(e, vault).unwrap_or_else(|r| refuse(e, r));
    VaultBound {
        vault: vault.clone(),
    }
    .publish(e);
}

pub(crate) fn finish_setup(e: &Env) {
    guards::setup_open(e);
    guards::no_hand_over_pending(e);
    setup::finish::<ClaimTopics>(e).unwrap_or_else(|r| refuse(e, r));
    SetupFinished {}.publish(e);
}

pub(crate) fn propose(e: &Env, change: TopicsChange) -> u32 {
    let queued = if is_removal(&change) {
        queue::propose::<RemovalHost, _>(e, &change)
    } else {
        queue::propose::<ClaimTopics, _>(e, &change)
    };
    let id = queued.unwrap_or_else(|r| refuse(e, r));
    let (_, schedule) =
        queue::pending::<TopicsChange>(e, id).unwrap_or_else(|| refuse(e, Refusal::NotFound));
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
        queue::pending::<TopicsChange>(e, id).unwrap_or_else(|| refuse(e, Refusal::NotFound));
    let ready = if is_removal(&waiting) {
        queue::take_ready::<RemovalHost, TopicsChange>(e, id)
    } else {
        queue::take_ready::<ClaimTopics, TopicsChange>(e, id)
    };
    let change = ready.unwrap_or_else(|r| refuse(e, r));
    match &change {
        TopicsChange::AddClaimTopic(topic) => add_topic(e, *topic),
        TopicsChange::RemoveClaimTopic(topic) => storage::remove_claim_topic(e, *topic),
        TopicsChange::AddTrustedIssuer(issuer, topics) => {
            guards::runs_kit_issuer_code(e, issuer);
            add_issuer(e, issuer, topics);
        }
        TopicsChange::RemoveTrustedIssuer(issuer) => storage::remove_trusted_issuer(e, issuer),
        TopicsChange::UpdateIssuerTopics(issuer, topics) => {
            storage::update_issuer_claim_topics(e, issuer, topics)
        }
        TopicsChange::IssuerWasm(wasm) => set_issuer_wasm(e, wasm),
        TopicsChange::Admin(next) => offer_admin(e, next),
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
pub(crate) fn pending(e: &Env) -> Vec<TopicsPendingChange> {
    let mut out = Vec::new(e);
    let open = queue::open_ids(e);
    if open.is_empty() {
        // Skips the vault, which is not bound yet during setup.
        return out;
    }
    let clock = vault_clock(e);
    for id in open.iter() {
        if let Some((change, schedule)) = queue::pending::<TopicsChange>(e, id) {
            out.push_back(TopicsPendingChange {
                id,
                change,
                eta: schedule.eta(&clock),
            });
        }
    }
    out
}
