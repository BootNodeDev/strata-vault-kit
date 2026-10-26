use soroban_sdk::{panic_with_error, token::TokenClient, Address, Env};
use stellar_tokens::rwa::RWATokenClient;

use crate::error::VaultError;
use crate::event::{RedeemCancelled, RedeemClaimed, RedeemRequested, RedemptionSurrendered};
use crate::guards;
use crate::keys::DataKey;
use crate::lock_policy::{self, Decision, Exit};
use crate::pricing::{Pricing, PricingScheme};
use crate::settlement;
use crate::state::{self, RedeemRequest};
use crate::wind_down;

pub(crate) fn request(e: &Env, holder: &Address, shares: i128) -> u64 {
    guards::not_winding_down(e);
    holder.require_auth();
    guards::positive_amount(e, shares);
    guards::allowed_to(e, Exit::RequestRedeem, holder);
    guards::needs_no_frozen_shares(e, holder, shares);
    let epoch_id = state::current_epoch(e);
    guards::no_open_redeem(e, epoch_id, holder);

    let mut epoch = state::get_epoch(e, epoch_id)
        .unwrap_or_else(|| panic_with_error!(e, VaultError::EpochNotFound));

    epoch.total_shares_redeeming = epoch
        .total_shares_redeeming
        .checked_add(shares)
        .unwrap_or_else(|| panic_with_error!(e, VaultError::AmountTooLarge));

    state::set_redeem_request(
        e,
        epoch_id,
        holder,
        &RedeemRequest {
            shares,
            claimed: false,
        },
    );
    state::set_epoch(e, epoch_id, &epoch);
    settlement::on_redeem_requested(e, epoch_id);

    let vault = e.current_contract_address();
    let share_token = state::get_addr(e, &DataKey::ShareToken);
    RWATokenClient::new(e, &share_token).forced_transfer(holder, &vault, &shares, &vault);

    RedeemRequested {
        holder: holder.clone(),
        epoch: epoch_id,
        shares,
    }
    .publish(e);

    epoch_id
}

pub(crate) fn claim(e: &Env, holder: &Address, epoch_id: u64) -> i128 {
    holder.require_auth();
    let epoch = state::get_epoch(e, epoch_id)
        .unwrap_or_else(|| panic_with_error!(e, VaultError::EpochNotFound));
    guards::epoch_fulfilled(e, &epoch);
    let mut request = state::get_redeem_request(e, epoch_id, holder)
        .unwrap_or_else(|| panic_with_error!(e, VaultError::RequestNotFound));
    guards::not_claimed(e, request.claimed);
    guards::allowed_to(e, Exit::ClaimRedeem, holder);

    let assets = Pricing::redeem_assets(e, request.shares, epoch.share_price)
        .unwrap_or_else(|err| panic_with_error!(e, err));

    state::set_pending_burn_shares(
        e,
        state::reduce(e, state::pending_burn_shares(e), request.shares),
    );

    // In a wind-down they are burned below instead: its snapshot left them out.
    if assets == 0 && !wind_down::is_active(e) {
        return_shares(e, holder, epoch_id, request.shares);
        settlement::on_redeem_claimed(e, epoch_id, 0);
        return 0;
    }

    guards::payout_covered(e, assets);

    let vault = e.current_contract_address();
    let asset = state::get_addr(e, &DataKey::Asset);

    request.claimed = true;
    state::set_redeem_request(e, epoch_id, holder, &request);
    state::set_committed(e, state::reduce(e, state::committed(e), assets));

    if assets > 0 {
        TokenClient::new(e, &asset).transfer(&vault, holder, &assets);
    }
    RWATokenClient::new(e, &state::get_addr(e, &DataKey::ShareToken)).burn(
        &vault,
        &request.shares,
        &vault,
    );

    RedeemClaimed {
        holder: holder.clone(),
        epoch: epoch_id,
        shares: request.shares,
        assets,
    }
    .publish(e);
    settlement::on_redeem_claimed(e, epoch_id, assets);

    assets
}

/// Queues shares the vault already holds, adding to any redemption open in the epoch.
pub(crate) fn queue_escrowed(e: &Env, holder: &Address, shares: i128) -> u64 {
    let epoch_id = state::current_epoch(e);
    let mut epoch = state::get_epoch(e, epoch_id)
        .unwrap_or_else(|| panic_with_error!(e, VaultError::EpochNotFound));
    epoch.total_shares_redeeming = epoch
        .total_shares_redeeming
        .checked_add(shares)
        .unwrap_or_else(|| panic_with_error!(e, VaultError::AmountTooLarge));

    let request = match state::get_redeem_request(e, epoch_id, holder) {
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
    state::set_redeem_request(e, epoch_id, holder, &request);
    state::set_epoch(e, epoch_id, &epoch);
    epoch_id
}

/// Moves escrowed shares back to the holder and clears the request.
fn return_shares(e: &Env, holder: &Address, epoch_id: u64, shares: i128) {
    let mut epoch = state::get_epoch(e, epoch_id)
        .unwrap_or_else(|| panic_with_error!(e, VaultError::EpochNotFound));
    epoch.total_shares_redeeming = state::reduce(e, epoch.total_shares_redeeming, shares);
    state::set_epoch(e, epoch_id, &epoch);
    state::remove_redeem_request(e, epoch_id, holder);

    deliver(e, holder, shares);

    RedeemCancelled {
        holder: holder.clone(),
        epoch: epoch_id,
        shares,
    }
    .publish(e);
}

/// Checks the receiver, then moves as manager, so the vault's listing and token pause never apply.
fn deliver(e: &Env, holder: &Address, shares: i128) {
    guards::eligible_to_receive(e, holder, shares);
    let vault = e.current_contract_address();
    let token = state::get_addr(e, &DataKey::ShareToken);
    RWATokenClient::new(e, &token).forced_transfer(&vault, holder, &shares, &vault);
}

pub(crate) fn cancel(e: &Env, holder: &Address, epoch_id: u64) -> i128 {
    holder.require_auth();
    let epoch = state::get_epoch(e, epoch_id)
        .unwrap_or_else(|| panic_with_error!(e, VaultError::EpochNotFound));
    guards::not_priced(e, &epoch);
    guards::no_price_available(e, &epoch);
    let request = state::get_redeem_request(e, epoch_id, holder)
        .unwrap_or_else(|| panic_with_error!(e, VaultError::RequestNotFound));
    let standing = lock_policy::standing(e, holder);
    let decision = lock_policy::decide(Exit::CancelRedeem, standing, wind_down::is_active(e));
    guards::not_refused(e, decision, standing);

    match decision {
        Decision::Proceed => return_shares(e, holder, epoch_id, request.shares),
        Decision::Surrender => surrender_escrow(e, holder, epoch_id, request.shares),
        Decision::Refuse | Decision::Hold | Decision::ConvertToExit => {
            panic_with_error!(e, lock_policy::refused_with(standing))
        }
    }
    settlement::on_redeem_cancelled(e, epoch_id);
    request.shares
}

/// Burns the escrow into the entitlement, so no token pause or allowlist place can hold it.
fn surrender_escrow(e: &Env, holder: &Address, epoch_id: u64, shares: i128) {
    let mut epoch = state::get_epoch(e, epoch_id)
        .unwrap_or_else(|| panic_with_error!(e, VaultError::EpochNotFound));
    epoch.total_shares_redeeming = state::reduce(e, epoch.total_shares_redeeming, shares);
    state::set_epoch(e, epoch_id, &epoch);
    state::remove_redeem_request(e, epoch_id, holder);

    let vault = e.current_contract_address();
    RWATokenClient::new(e, &state::get_addr(e, &DataKey::ShareToken)).burn(&vault, &shares, &vault);
    wind_down::credit(e, holder, shares);

    RedemptionSurrendered {
        holder: holder.clone(),
        epoch: epoch_id,
        shares,
    }
    .publish(e);
}
