use bindings::ShareClient;
use soroban_sdk::{panic_with_error, token::TokenClient, Address, Env};
use stellar_contract_utils::math::{i128_fixed_point::checked_mul_div_floor, wad::WAD_SCALE};

use crate::error::VaultError;
use crate::event::{RedeemCancelled, RedeemClaimed, RedeemRequested};
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
        return_shares(e, caller, epoch_id, request.shares);
        return 0;
    }

    // Against liquid reserve, not the raw balance: escrow a depositor can still
    // cancel is not available to pay an exit.
    if crate::treasury::liquid_reserve(e) < assets {
        panic_with_error!(e, VaultError::ClaimNotCovered);
    }

    let vault = e.current_contract_address();
    let asset = state::get_addr(e, &DataKey::Asset);

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

/// Moves escrowed shares back to the controller and clears the request. The
/// checked transfer is deliberate: the share token decides whether this holder
/// may receive a regulated share, so a frozen or de-listed controller is refused
/// here and exits through the cash claim instead.
fn return_shares(e: &Env, controller: &Address, epoch_id: u64, shares: i128) {
    let mut epoch = state::get_epoch(e, epoch_id)
        .unwrap_or_else(|| panic_with_error!(e, VaultError::EpochNotFound));
    epoch.total_shares_redeeming -= shares;
    state::set_epoch(e, epoch_id, &epoch);
    state::remove_redeem_request(e, epoch_id, controller);

    let vault = e.current_contract_address();
    ShareClient::new(e, &state::get_addr(e, &DataKey::ShareToken))
        .transfer(&vault, controller, &shares);

    RedeemCancelled {
        controller: controller.clone(),
        epoch: epoch_id,
        shares,
    }
    .publish(e);
}

pub(crate) fn cancel(e: &Env, from: &Address, epoch_id: u64) -> i128 {
    from.require_auth();

    let epoch = state::get_epoch(e, epoch_id)
        .unwrap_or_else(|| panic_with_error!(e, VaultError::EpochNotFound));

    if epoch.status == EpochStatus::Fulfilled {
        panic_with_error!(e, VaultError::AlreadyPriced);
    }

    // Cancellation is an escape hatch, not a choice. Once the feed can price a
    // sealed epoch, the price is knowable and the only way out is to take it.
    if crate::epoch::is_priceable(e, &epoch) {
        panic_with_error!(e, VaultError::PriceAvailable);
    }

    let request = state::get_redeem_request(e, epoch_id, from)
        .unwrap_or_else(|| panic_with_error!(e, VaultError::RequestNotFound));

    return_shares(e, from, epoch_id, request.shares);
    request.shares
}
