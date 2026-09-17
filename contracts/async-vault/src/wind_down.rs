use bindings::ShareClient;
use soroban_sdk::{contracttype, panic_with_error, Address, Env};
use stellar_contract_utils::math::{i128_fixed_point::checked_mul_div_floor, wad::WAD_SCALE};

use crate::error::VaultError;
use crate::event::{
    WindDownActivated, WindDownDelaySet, WindDownProposalCancelled, WindDownProposed,
    WindDownRoundFinalized,
};
use crate::keys::DataKey;
use crate::state;

/// Ninety days. Long enough for a real announcement period, short enough that
/// governance cannot set a delay the vault would never outlive.
pub const MAX_WIND_DOWN_DELAY: u64 = 90 * 24 * 60 * 60;

#[contracttype]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum WindDownStatus {
    Proposed,
    Active,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct WindDownInfo {
    pub status: WindDownStatus,
    /// Ledger time the proposal may be activated.
    pub active_at: u64,
    /// Rounds finalised so far. Zero means no snapshot has been taken.
    pub round: u32,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct WindDownPosition {
    pub entitlement: i128,
    /// The accumulator this holder has already been paid up to.
    pub watermark: i128,
}

pub(crate) fn delay(e: &Env) -> u64 {
    storage::get_instance(e, &DataKey::WindDownDelay).unwrap_or(0)
}

pub(crate) fn set_delay(e: &Env, secs: u64) {
    if secs > MAX_WIND_DOWN_DELAY {
        panic_with_error!(e, VaultError::WindDownDelayTooLong);
    }
    storage::set_instance(e, &DataKey::WindDownDelay, &secs);
    WindDownDelaySet { secs }.publish(e);
}

pub(crate) fn info(e: &Env) -> Option<WindDownInfo> {
    storage::get_instance(e, &DataKey::WindDown)
}

pub(crate) fn is_active(e: &Env) -> bool {
    matches!(
        info(e),
        Some(WindDownInfo {
            status: WindDownStatus::Active,
            ..
        })
    )
}

/// Called at the top of every entrypoint the wind-down closes.
pub(crate) fn refuse_if_active(e: &Env) {
    if is_active(e) {
        panic_with_error!(e, VaultError::WindDownActive);
    }
}

pub(crate) fn propose(e: &Env) {
    if info(e).is_some() {
        panic_with_error!(e, VaultError::WindDownAlreadyProposed);
    }

    let active_at = e.ledger().timestamp().saturating_add(delay(e));
    storage::set_instance(
        e,
        &DataKey::WindDown,
        &WindDownInfo {
            status: WindDownStatus::Proposed,
            active_at,
            round: 0,
        },
    );

    WindDownProposed { active_at }.publish(e);
}

pub(crate) fn cancel_proposal(e: &Env) {
    match info(e) {
        Some(WindDownInfo {
            status: WindDownStatus::Proposed,
            ..
        }) => {}
        Some(_) => panic_with_error!(e, VaultError::WindDownActive),
        None => panic_with_error!(e, VaultError::WindDownNotProposed),
    }

    e.storage().instance().remove(&DataKey::WindDown);
    WindDownProposalCancelled {}.publish(e);
}

pub(crate) fn activate(e: &Env) {
    let mut wd = info(e).unwrap_or_else(|| panic_with_error!(e, VaultError::WindDownNotProposed));

    if wd.status == WindDownStatus::Active {
        panic_with_error!(e, VaultError::WindDownActive);
    }
    if e.ledger().timestamp() < wd.active_at {
        panic_with_error!(e, VaultError::WindDownDelayNotElapsed);
    }

    wd.status = WindDownStatus::Active;
    storage::set_instance(e, &DataKey::WindDown, &wd);

    WindDownActivated {}.publish(e);
}

pub(crate) fn owed(e: &Env) -> i128 {
    storage::get_instance(e, &DataKey::WindDownOwed).unwrap_or(0)
}

pub(crate) fn acc(e: &Env) -> i128 {
    storage::get_instance(e, &DataKey::WindDownAcc).unwrap_or(0)
}

pub(crate) fn supply_snapshot(e: &Env) -> i128 {
    storage::get_instance(e, &DataKey::WindDownSupply).unwrap_or(0)
}

/// Shares that exist or are owed: circulating, escrowed against an unpriced
/// redemption, and owed by a deposit that has been priced but not claimed.
fn snapshot_supply(e: &Env) -> i128 {
    let share_token = state::get_addr(e, &DataKey::ShareToken);
    ShareClient::new(e, &share_token)
        .total_supply()
        .checked_add(state::pending_mint_shares(e))
        .unwrap_or_else(|| panic_with_error!(e, VaultError::AmountTooLarge))
}

pub(crate) fn finalize_round(e: &Env) -> i128 {
    let mut wd = info(e).unwrap_or_else(|| panic_with_error!(e, VaultError::WindDownNotActive));
    if wd.status != WindDownStatus::Active {
        panic_with_error!(e, VaultError::WindDownNotActive);
    }

    let snapshot = if wd.round == 0 {
        let s = snapshot_supply(e);
        storage::set_instance(e, &DataKey::WindDownSupply, &s);
        s
    } else {
        supply_snapshot(e)
    };

    if snapshot <= 0 {
        panic_with_error!(e, VaultError::NothingToDistribute);
    }

    let pot = crate::treasury::free_reserve(e);
    let delta = checked_mul_div_floor(e, &pot, &WAD_SCALE, &snapshot)
        .unwrap_or_else(|| panic_with_error!(e, VaultError::AmountTooLarge));
    if delta <= 0 {
        panic_with_error!(e, VaultError::NothingToDistribute);
    }

    // What the accumulator actually promises, which is the pot less the dust the
    // division dropped. The dust stays free and joins the next round.
    let credited = checked_mul_div_floor(e, &delta, &snapshot, &WAD_SCALE)
        .unwrap_or_else(|| panic_with_error!(e, VaultError::AmountTooLarge));

    let acc_per_share = acc(e)
        .checked_add(delta)
        .unwrap_or_else(|| panic_with_error!(e, VaultError::AmountTooLarge));
    storage::set_instance(e, &DataKey::WindDownAcc, &acc_per_share);
    storage::set_instance(e, &DataKey::WindDownOwed, &(owed(e) + credited));

    wd.round += 1;
    storage::set_instance(e, &DataKey::WindDown, &wd);

    WindDownRoundFinalized {
        round: wd.round,
        pot: credited,
        acc_per_share,
    }
    .publish(e);

    credited
}
