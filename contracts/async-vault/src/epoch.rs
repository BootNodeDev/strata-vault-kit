use bindings::{OracleFeedClient, OracleState};
use soroban_sdk::{panic_with_error, Env};

use crate::error::VaultError;
use crate::event::EpochFulfilled;
use crate::keys::DataKey;
use crate::state::{self, EpochInfo, EpochStatus};

pub(crate) fn open(total_deposited: i128) -> EpochInfo {
    EpochInfo {
        status: EpochStatus::Open,
        total_deposited,
        total_shares_redeeming: 0,
        share_price: 0,
    }
}

pub(crate) fn fulfill(e: &Env) -> u64 {
    let feed = OracleFeedClient::new(e, &state::get_addr(e, &DataKey::Oracle));

    if feed.state() != OracleState::Valid {
        panic_with_error!(e, VaultError::OracleNotConsumable);
    }

    let share_price = feed.nav_per_share();
    if share_price <= 0 {
        panic_with_error!(e, VaultError::InvalidSharePrice);
    }

    let current = state::current_epoch(e);
    let mut epoch = state::get_epoch(e, current)
        .unwrap_or_else(|| panic_with_error!(e, VaultError::EpochNotFound));

    if epoch.status != EpochStatus::Open {
        panic_with_error!(e, VaultError::EpochNotOpen);
    }

    let next = current
        .checked_add(1)
        .unwrap_or_else(|| panic_with_error!(e, VaultError::EpochOverflow));

    epoch.status = EpochStatus::Fulfilled;
    epoch.share_price = share_price;
    state::set_epoch(e, current, &epoch);

    state::set_epoch(e, next, &open(0));
    state::set_current_epoch(e, next);

    EpochFulfilled {
        epoch: current,
        share_price,
        total_deposited: epoch.total_deposited,
    }
    .publish(e);

    next
}
