use soroban_sdk::{contracttype, panic_with_error, BytesN, Env};

use crate::error::VaultError;
use crate::event::{UpgradeCancelled, UpgradeDelayProposed, UpgradeProposed};
use crate::keys::DataKey;
use crate::state;

/// Seven days. Short enough to fix a defect in a week, long enough that an
/// investor who dislikes the change has time to act on it.
pub const MIN_UPGRADE_DELAY: u64 = 7 * 24 * 60 * 60;

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum UpgradeAction {
    Wasm(BytesN<32>),
    Delay(u64),
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct UpgradeProposal {
    pub action: UpgradeAction,
    pub eta: u64,
}

pub(crate) fn delay(e: &Env) -> u64 {
    storage::get_instance(e, &DataKey::UpgradeDelay).unwrap_or(MIN_UPGRADE_DELAY)
}

pub(crate) fn proposal(e: &Env) -> Option<UpgradeProposal> {
    storage::get_instance(e, &DataKey::UpgradeProposal)
}

/// An exit takes a full notice, so a delay shorter than one is not a window.
fn check_delay(e: &Env, secs: u64) {
    if secs < MIN_UPGRADE_DELAY {
        panic_with_error!(e, VaultError::UpgradeDelayTooShort);
    }
    if secs < state::notice(e) {
        panic_with_error!(e, VaultError::UpgradeDelayBelowNotice);
    }
}

fn queue(e: &Env, action: UpgradeAction) -> u64 {
    if proposal(e).is_some() {
        panic_with_error!(e, VaultError::UpgradeProposalExists);
    }
    let eta = e.ledger().timestamp().saturating_add(delay(e));
    storage::set_instance(
        e,
        &DataKey::UpgradeProposal,
        &UpgradeProposal { action, eta },
    );
    eta
}

pub(crate) fn propose_wasm(e: &Env, wasm_hash: BytesN<32>) {
    let eta = queue(e, UpgradeAction::Wasm(wasm_hash));
    UpgradeProposed { eta }.publish(e);
}

pub(crate) fn propose_delay(e: &Env, secs: u64) {
    check_delay(e, secs);
    let eta = queue(e, UpgradeAction::Delay(secs));
    UpgradeDelayProposed { secs, eta }.publish(e);
}

pub(crate) fn cancel(e: &Env) {
    if proposal(e).is_none() {
        panic_with_error!(e, VaultError::UpgradeProposalNotFound);
    }
    e.storage().instance().remove(&DataKey::UpgradeProposal);
    UpgradeCancelled {}.publish(e);
}
