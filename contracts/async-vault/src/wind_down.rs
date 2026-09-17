use soroban_sdk::{contracttype, panic_with_error, Address, Env};

use crate::error::VaultError;
use crate::event::WindDownDelaySet;
use crate::keys::DataKey;

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
