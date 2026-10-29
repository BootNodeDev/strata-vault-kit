use soroban_sdk::{panic_with_error, BytesN, Env, String};
use stellar_access::{access_control::AccessControlStorageKey, role_transfer};
use strata_timelock::{queue, setup, TimelockHost};

use crate::state::{self, get_config, NavReport, OracleConfig, OracleState};
use crate::NavOracleContract;
use crate::{
    compute_state, in_band, shortens_freshness_only, OracleChange, OracleError, BPS_DENOM,
    MAX_ANSWER, MAX_FRESHNESS_SECS, MAX_PROOF_URI_LEN, MIN_ANSWER, MIN_COOLDOWN_SECS,
};

pub(crate) fn valid_config(e: &Env, cfg: &OracleConfig) {
    if cfg.freshness_duration == 0
        || cfg.freshness_duration > MAX_FRESHNESS_SECS
        || cfg.cooldown_secs < MIN_COOLDOWN_SECS
        || cfg.cooldown_secs > cfg.freshness_duration
        || cfg.min_answer < MIN_ANSWER
        || cfg.max_answer < cfg.min_answer
        || cfg.max_answer > MAX_ANSWER
        || !bps_in_range(cfg.max_up_bps)
        || !bps_in_range(cfg.max_down_bps)
    {
        panic_with_error!(e, OracleError::InvalidConfig);
    }
}

fn bps_in_range(bps: u32) -> bool {
    bps > 0 && bps as i128 <= BPS_DENOM
}

pub(crate) fn setup_open(e: &Env) {
    if !setup::is_open(e) {
        panic_with_error!(e, OracleError::SetupClosed);
    }
}

/// No nominee from setup may accept once changes wait, so a hand-over offered
/// during setup holds it open.
pub(crate) fn no_hand_over_pending(e: &Env) {
    if role_transfer::has_active_pending_transfer(e, &AccessControlStorageKey::PendingAdmin) {
        panic_with_error!(e, OracleError::AdminTransferPending);
    }
}

/// Passes before a vault is bound: there is no wind-down to read yet.
pub(crate) fn vault_not_winding_down(e: &Env) {
    if <NavOracleContract as TimelockHost>::clock(e).is_ok_and(|clock| clock.winding_down) {
        panic_with_error!(e, OracleError::WindDownActive);
    }
}

/// Direct admin calls are instant only before setup finishes.
pub(crate) fn direct_change_allowed(e: &Env) {
    if !setup::is_open(e) {
        panic_with_error!(e, OracleError::UseTimelock);
    }
}

/// Only an offer needs setup open; cancelling one (`0`) keeps the admin.
pub(crate) fn direct_hand_over_allowed(e: &Env, live_until_ledger: u32) {
    if live_until_ledger != 0 {
        direct_change_allowed(e);
    }
}

pub(crate) fn direct_config_allowed(e: &Env, config: &OracleConfig) {
    if !setup::is_open(e) && !shortens_freshness_only(&get_config(e), config) {
        panic_with_error!(e, OracleError::UseTimelock);
    }
}

/// The bounds a change must meet when it is proposed and again when it
/// applies.
pub(crate) fn change_in_bounds(e: &Env, change: &OracleChange) {
    if let OracleChange::Config(config) = change {
        valid_config(e, config);
    }
}

/// One upgrade at a time, so a standing eta is never quietly replaced.
pub(crate) fn not_a_second_upgrade(e: &Env, change: &OracleChange) {
    if matches!(change, OracleChange::Upgrade(_)) && upgrade_pending(e) {
        panic_with_error!(e, OracleError::UpgradeAlreadyPending);
    }
}

fn upgrade_pending(e: &Env) -> bool {
    queue::open_ids(e).iter().any(|id| {
        queue::pending::<OracleChange>(e, id)
            .is_some_and(|(change, _)| matches!(change, OracleChange::Upgrade(_)))
    })
}

pub(crate) fn consumable(e: &Env) {
    if compute_state(e) != OracleState::Valid {
        panic_with_error!(e, OracleError::NotConsumable);
    }
}

pub(crate) fn nav_not_paused(e: &Env) {
    if state::nav_paused(e) {
        panic_with_error!(e, OracleError::NavPaused);
    }
}

pub(crate) fn nav_paused(e: &Env) {
    if !state::nav_paused(e) {
        panic_with_error!(e, OracleError::NavNotPaused);
    }
}

pub(crate) fn nav_in_band(e: &Env, cfg: &OracleConfig, nav_per_share: i128) {
    if !in_band(cfg, nav_per_share) {
        panic_with_error!(e, OracleError::NavOutOfBand);
    }
}

pub(crate) fn expires_in_future(e: &Env, expires_at: u64) {
    if expires_at <= e.ledger().timestamp() {
        panic_with_error!(e, OracleError::ExpiresInPast);
    }
}

pub(crate) fn proof_hash_not_empty(e: &Env, proof_hash: &BytesN<32>) {
    if proof_hash.to_array() == [0; 32] {
        panic_with_error!(e, OracleError::EmptyProofHash);
    }
}

pub(crate) fn proof_uri_fits(e: &Env, proof_uri: &String) {
    if proof_uri.len() > MAX_PROOF_URI_LEN {
        panic_with_error!(e, OracleError::ProofUriTooLong);
    }
}

pub(crate) fn cooldown_elapsed(e: &Env, cfg: &OracleConfig, last: &NavReport) {
    if e.ledger().timestamp() < last.accepted_at.saturating_add(cfg.cooldown_secs) {
        panic_with_error!(e, OracleError::CooldownActive);
    }
}

pub(crate) fn within_deviation(e: &Env, cfg: &OracleConfig, last: &NavReport, nav_per_share: i128) {
    let bps = if nav_per_share >= last.nav_per_share {
        cfg.max_up_bps
    } else {
        cfg.max_down_bps
    };
    let diff = (nav_per_share - last.nav_per_share).abs();
    let bound = last.nav_per_share * (bps as i128) / BPS_DENOM;
    if diff > bound {
        panic_with_error!(e, OracleError::DeviationExceeded);
    }
}
