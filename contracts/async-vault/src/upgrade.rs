use soroban_sdk::{panic_with_error, Env};

use crate::error::VaultError;
use crate::keys::DataKey;
use crate::state;

/// Seven days. Short enough to fix a defect in a week, long enough that an
/// investor who dislikes the change has time to act on it.
pub const MIN_UPGRADE_DELAY: u64 = strata_timelock::MIN_DELAY;
/// Ninety days. Prevents setting a delay that effectively brick-walls the vault
/// against future upgrades.
pub const MAX_UPGRADE_DELAY: u64 = strata_timelock::MAX_DELAY;

pub(crate) fn delay(e: &Env) -> u64 {
    strata_storage::get_instance(e, &DataKey::UpgradeDelay).unwrap_or(MIN_UPGRADE_DELAY)
}

pub(crate) fn set_delay(e: &Env, secs: u64) {
    strata_storage::set_instance(e, &DataKey::UpgradeDelay, &secs);
}

/// An exit takes a full notice, so a delay shorter than one is not a window.
pub(crate) fn check_delay(e: &Env, secs: u64) {
    if secs < MIN_UPGRADE_DELAY {
        panic_with_error!(e, VaultError::UpgradeDelayTooShort);
    }
    if secs > MAX_UPGRADE_DELAY {
        panic_with_error!(e, VaultError::UpgradeDelayTooLong);
    }
    if secs < state::notice(e) {
        panic_with_error!(e, VaultError::UpgradeDelayBelowNotice);
    }
}
