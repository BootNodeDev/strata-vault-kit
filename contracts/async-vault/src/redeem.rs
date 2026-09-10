use bindings::ShareClient;
use soroban_sdk::{panic_with_error, token::TokenClient, Address, Env};
use stellar_contract_utils::math::{i128_fixed_point::checked_mul_div_floor, wad::WAD_SCALE};

use crate::error::VaultError;
use crate::event::{RedeemClaimed, RedeemRequested};
use crate::keys::DataKey;
use crate::state::{self, EpochStatus, RedeemRequest};

pub(crate) fn request(e: &Env, from: &Address, shares: i128) -> u64 {
    from.require_auth();

    if shares <= 0 {
        panic_with_error!(e, VaultError::InvalidAmount);
    }

    let epoch_id = state::current_epoch(e);

    if state::get_redeem_request(e, epoch_id, from).is_some() {
        panic_with_error!(e, VaultError::RequestOutstanding);
    }

    let mut epoch = state::get_epoch(e, epoch_id)
        .unwrap_or_else(|| panic_with_error!(e, VaultError::EpochNotFound));

    epoch.total_shares_redeeming = epoch
        .total_shares_redeeming
        .checked_add(shares)
        .unwrap_or_else(|| panic_with_error!(e, VaultError::AmountTooLarge));

    state::set_redeem_request(
        e,
        epoch_id,
        from,
        &RedeemRequest {
            shares,
            claimed: false,
        },
    );
    state::set_epoch(e, epoch_id, &epoch);

    let vault = e.current_contract_address();
    let share_token = state::get_addr(e, &DataKey::ShareToken);
    ShareClient::new(e, &share_token).forced_transfer(from, &vault, &shares, &vault);

    RedeemRequested {
        controller: from.clone(),
        epoch: epoch_id,
        shares,
    }
    .publish(e);

    epoch_id
}

pub(crate) fn claim(e: &Env, caller: &Address, epoch_id: u64) -> i128 {
    caller.require_auth();

    let epoch = state::get_epoch(e, epoch_id)
        .unwrap_or_else(|| panic_with_error!(e, VaultError::EpochNotFound));

    if epoch.status != EpochStatus::Fulfilled {
        panic_with_error!(e, VaultError::EpochNotFulfilled);
    }

    let mut request = state::get_redeem_request(e, epoch_id, caller)
        .unwrap_or_else(|| panic_with_error!(e, VaultError::RequestNotFound));

    if request.claimed {
        panic_with_error!(e, VaultError::AlreadyClaimed);
    }

    let assets = checked_mul_div_floor(e, &request.shares, &epoch.share_price, &WAD_SCALE)
        .unwrap_or_else(|| panic_with_error!(e, VaultError::AmountTooLarge));

    if assets == 0 {
        panic_with_error!(e, VaultError::NothingToClaim);
    }

    let vault = e.current_contract_address();
    let asset = state::get_addr(e, &DataKey::Asset);
    if TokenClient::new(e, &asset).balance(&vault) < assets {
        panic_with_error!(e, VaultError::ClaimNotCovered);
    }

    request.claimed = true;
    state::set_redeem_request(e, epoch_id, caller, &request);
    state::set_committed(e, state::committed(e).saturating_sub(assets));

    TokenClient::new(e, &asset).transfer(&vault, caller, &assets);
    ShareClient::new(e, &state::get_addr(e, &DataKey::ShareToken)).burn(
        &vault,
        &request.shares,
        &vault,
    );

    RedeemClaimed {
        controller: caller.clone(),
        epoch: epoch_id,
        shares: request.shares,
        assets,
    }
    .publish(e);

    assets
}
