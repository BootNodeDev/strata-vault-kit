use soroban_sdk::{panic_with_error, token::TokenClient, Address, Env};
use stellar_tokens::{fungible::FungibleTokenClient, rwa::RWATokenClient};

use crate::epoch;
use crate::error::VaultError;
use crate::event::{RedeemCancelled, RedeemClaimed, RedeemRequested, RedemptionSurrendered};
use crate::keys::DataKey;
use crate::lock_policy::{self, Decision, Exit};
use crate::pricing::{Pricing, PricingScheme};
use crate::settlement;
use crate::state::{self, EpochStatus, RedeemRequest};
use crate::treasury;
use crate::wind_down;

pub(crate) fn request(e: &Env, from: &Address, shares: i128) -> u64 {
    wind_down::refuse_if_active(e);
    from.require_auth();

    if shares <= 0 {
        panic_with_error!(e, VaultError::InvalidAmount);
    }

    let standing = lock_policy::standing(e, from);
    match lock_policy::decide(Exit::RequestRedeem, standing, wind_down::is_active(e)) {
        Decision::Proceed => {}
        Decision::Refuse | Decision::Hold | Decision::ConvertToExit | Decision::Surrender => {
            panic_with_error!(e, lock_policy::refused_with(standing))
        }
    }
    // The escrow transfer releases a partial freeze, so frozen shares are
    // kept out of it here.
    if shares > lock_policy::free_shares(e, from) {
        panic_with_error!(e, VaultError::Frozen);
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
    settlement::on_redeem_requested(e, epoch_id);

    let vault = e.current_contract_address();
    let share_token = state::get_addr(e, &DataKey::ShareToken);
    RWATokenClient::new(e, &share_token).forced_transfer(from, &vault, &shares, &vault);

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

    let standing = lock_policy::standing(e, caller);
    match lock_policy::decide(Exit::ClaimRedeem, standing, wind_down::is_active(e)) {
        Decision::Proceed => {}
        Decision::Refuse | Decision::Hold | Decision::ConvertToExit | Decision::Surrender => {
            panic_with_error!(e, lock_policy::refused_with(standing))
        }
    }

    let assets = Pricing::redeem_assets(e, request.shares, epoch.share_price)
        .unwrap_or_else(|err| panic_with_error!(e, err));

    state::set_pending_burn_shares(
        e,
        state::reduce(e, state::pending_burn_shares(e), request.shares),
    );

    // In a wind-down they are burned below instead: its snapshot left them out.
    if assets == 0 && !wind_down::is_active(e) {
        return_shares(e, caller, epoch_id, request.shares);
        settlement::on_redeem_claimed(e, epoch_id, 0);
        return 0;
    }

    // Against liquid reserve, not the raw balance: escrow a depositor can still
    // cancel is not available to pay an exit.
    if treasury::liquid_reserve(e) < assets {
        panic_with_error!(e, VaultError::ClaimNotCovered);
    }

    let vault = e.current_contract_address();
    let asset = state::get_addr(e, &DataKey::Asset);

    request.claimed = true;
    state::set_redeem_request(e, epoch_id, caller, &request);
    state::set_committed(e, state::reduce(e, state::committed(e), assets));

    if assets > 0 {
        TokenClient::new(e, &asset).transfer(&vault, caller, &assets);
    }
    RWATokenClient::new(e, &state::get_addr(e, &DataKey::ShareToken)).burn(
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
    settlement::on_redeem_claimed(e, epoch_id, assets);

    assets
}

/// Queues shares the vault already holds, adding to any redemption open in the epoch.
pub(crate) fn queue_escrowed(e: &Env, controller: &Address, shares: i128) -> u64 {
    let epoch_id = state::current_epoch(e);
    let mut epoch = state::get_epoch(e, epoch_id)
        .unwrap_or_else(|| panic_with_error!(e, VaultError::EpochNotFound));
    epoch.total_shares_redeeming = epoch
        .total_shares_redeeming
        .checked_add(shares)
        .unwrap_or_else(|| panic_with_error!(e, VaultError::AmountTooLarge));

    let request = match state::get_redeem_request(e, epoch_id, controller) {
        Some(mut open) => {
            open.shares = open
                .shares
                .checked_add(shares)
                .unwrap_or_else(|| panic_with_error!(e, VaultError::AmountTooLarge));
            open
        }
        None => {
            settlement::on_redeem_requested(e, epoch_id);
            RedeemRequest {
                shares,
                claimed: false,
            }
        }
    };
    state::set_redeem_request(e, epoch_id, controller, &request);
    state::set_epoch(e, epoch_id, &epoch);
    epoch_id
}

/// Moves escrowed shares back to the controller and clears the request. Both
/// callers ask the lock policy first; a delisted controller still meets the
/// token's own checked transfer here.
fn return_shares(e: &Env, controller: &Address, epoch_id: u64, shares: i128) {
    let mut epoch = state::get_epoch(e, epoch_id)
        .unwrap_or_else(|| panic_with_error!(e, VaultError::EpochNotFound));
    epoch.total_shares_redeeming = state::reduce(e, epoch.total_shares_redeeming, shares);
    state::set_epoch(e, epoch_id, &epoch);
    state::remove_redeem_request(e, epoch_id, controller);

    let vault = e.current_contract_address();
    FungibleTokenClient::new(e, &state::get_addr(e, &DataKey::ShareToken))
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

    let winding_down = wind_down::is_active(e);

    // Cancellation is an escape hatch, not a choice. Once the feed can price a
    // sealed epoch, the price is knowable and the only way out is to take it.
    // Fulfilment is closed during a wind-down, so this epoch will never take a
    // price. There is nothing to decline.
    if !winding_down && epoch::is_priceable(e, &epoch) {
        panic_with_error!(e, VaultError::PriceAvailable);
    }

    let request = state::get_redeem_request(e, epoch_id, from)
        .unwrap_or_else(|| panic_with_error!(e, VaultError::RequestNotFound));

    let standing = lock_policy::standing(e, from);
    match lock_policy::decide(Exit::CancelRedeem, standing, winding_down) {
        Decision::Proceed => return_shares(e, from, epoch_id, request.shares),
        Decision::Surrender => surrender_escrow(e, from, epoch_id, request.shares),
        Decision::Refuse | Decision::Hold | Decision::ConvertToExit => {
            panic_with_error!(e, lock_policy::refused_with(standing))
        }
    }
    settlement::on_redeem_cancelled(e, epoch_id);
    request.shares
}

/// Burns the escrow into the entitlement, so no token pause or allowlist place can hold it.
fn surrender_escrow(e: &Env, controller: &Address, epoch_id: u64, shares: i128) {
    let mut epoch = state::get_epoch(e, epoch_id)
        .unwrap_or_else(|| panic_with_error!(e, VaultError::EpochNotFound));
    epoch.total_shares_redeeming = state::reduce(e, epoch.total_shares_redeeming, shares);
    state::set_epoch(e, epoch_id, &epoch);
    state::remove_redeem_request(e, epoch_id, controller);

    let vault = e.current_contract_address();
    RWATokenClient::new(e, &state::get_addr(e, &DataKey::ShareToken)).burn(&vault, &shares, &vault);
    wind_down::credit(e, controller, shares);

    RedemptionSurrendered {
        controller: controller.clone(),
        epoch: epoch_id,
        shares,
    }
    .publish(e);
}
