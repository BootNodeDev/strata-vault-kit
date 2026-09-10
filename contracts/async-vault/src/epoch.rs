use bindings::OracleFeedClient;
use soroban_sdk::{panic_with_error, Env};
use stellar_contract_utils::math::{i128_fixed_point::checked_mul_div_floor, wad::WAD_SCALE};

use crate::error::VaultError;
use crate::event::{EpochClosed, EpochFulfilled};
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

pub(crate) fn close(e: &Env) -> u64 {
    let current = state::current_epoch(e);
    let mut epoch = state::get_epoch(e, current)
        .unwrap_or_else(|| panic_with_error!(e, VaultError::EpochNotFound));

    if epoch.status != EpochStatus::Open {
        panic_with_error!(e, VaultError::EpochNotOpen);
    }

    let next = current
        .checked_add(1)
        .unwrap_or_else(|| panic_with_error!(e, VaultError::EpochOverflow));

    epoch.status = EpochStatus::Pending;
    state::set_epoch(e, current, &epoch);

    state::set_epoch(e, next, &open(0));
    state::set_current_epoch(e, next);

    EpochClosed {
        epoch: current,
        total_deposited: epoch.total_deposited,
        total_shares_redeeming: epoch.total_shares_redeeming,
    }
    .publish(e);

    current
}

pub(crate) fn fulfill(e: &Env, epoch_id: u64) -> i128 {
    let mut epoch = state::get_epoch(e, epoch_id)
        .unwrap_or_else(|| panic_with_error!(e, VaultError::EpochNotFound));

    if epoch.status != EpochStatus::Pending {
        panic_with_error!(e, VaultError::EpochNotPending);
    }

    let feed = OracleFeedClient::new(e, &state::get_addr(e, &DataKey::Oracle));
    feed.ensure_consumable();

    let share_price = feed.nav_per_share();
    if share_price <= 0 {
        panic_with_error!(e, VaultError::InvalidSharePrice);
    }

    let owed = checked_mul_div_floor(e, &epoch.total_shares_redeeming, &share_price, &WAD_SCALE)
        .unwrap_or_else(|| panic_with_error!(e, VaultError::AmountTooLarge));
    let committed = state::committed(e)
        .checked_add(owed)
        .unwrap_or_else(|| panic_with_error!(e, VaultError::AmountTooLarge));
    state::set_committed(e, committed);

    if epoch.total_deposited > 0 {
        if let Some(shares_owed) =
            checked_mul_div_floor(e, &epoch.total_deposited, &WAD_SCALE, &share_price)
        {
            let updated_pending_mint = state::pending_mint_shares(e)
                .checked_add(shares_owed)
                .unwrap_or_else(|| panic_with_error!(e, VaultError::AmountTooLarge));
            state::set_pending_mint_shares(e, updated_pending_mint);
        }
    }

    state::set_cancellable_escrow(e, state::cancellable_escrow(e) - epoch.total_deposited);

    epoch.status = EpochStatus::Fulfilled;
    epoch.share_price = share_price;
    state::set_epoch(e, epoch_id, &epoch);

    EpochFulfilled {
        epoch: epoch_id,
        share_price,
        total_deposited: epoch.total_deposited,
    }
    .publish(e);

    share_price
}
