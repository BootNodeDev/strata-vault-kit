use bindings::ShareClient;
use soroban_sdk::{panic_with_error, token::TokenClient, Address, Env};
use stellar_contract_utils::math::{i128_fixed_point::checked_mul_div_floor, wad::WAD_SCALE};

use crate::error::VaultError;
use crate::event::{DepositCancelled, DepositClaimed, DepositRequested};
use crate::keys::DataKey;
use crate::state::{self, DepositRequest, EpochStatus};
use crate::treasury;

pub(crate) fn request(e: &Env, from: &Address, amount: i128) -> u64 {
    from.require_auth();

    if amount <= 0 {
        panic_with_error!(e, VaultError::InvalidAmount);
    }

    let epoch_id = state::current_epoch(e);

    if state::get_deposit_request(e, epoch_id, from).is_some() {
        panic_with_error!(e, VaultError::RequestOutstanding);
    }

    let mut epoch = state::get_epoch(e, epoch_id)
        .unwrap_or_else(|| panic_with_error!(e, VaultError::EpochNotFound));

    epoch.total_deposited = epoch
        .total_deposited
        .checked_add(amount)
        .unwrap_or_else(|| panic_with_error!(e, VaultError::AmountTooLarge));

    state::set_deposit_request(
        e,
        epoch_id,
        from,
        &DepositRequest {
            amount,
            claimed: false,
        },
    );
    state::set_epoch(e, epoch_id, &epoch);
    state::set_cancellable_escrow(e, state::cancellable_escrow(e) + amount);

    let asset = state::get_addr(e, &DataKey::Asset);
    TokenClient::new(e, &asset).transfer(from, e.current_contract_address(), &amount);

    DepositRequested {
        controller: from.clone(),
        epoch: epoch_id,
        amount,
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

    let mut request = state::get_deposit_request(e, epoch_id, caller)
        .unwrap_or_else(|| panic_with_error!(e, VaultError::RequestNotFound));

    if request.claimed {
        panic_with_error!(e, VaultError::AlreadyClaimed);
    }

    let shares = checked_mul_div_floor(e, &request.amount, &WAD_SCALE, &epoch.share_price)
        .unwrap_or_else(|| panic_with_error!(e, VaultError::AmountTooLarge));

    if shares == 0 {
        // Pricing already released this epoch's escrow into the reserve, so a
        // refund now is an extra payout rather than part of committed. It comes
        // out of free reserve and must not reach money owed to a priced exit.
        if treasury::free_reserve(e) < request.amount {
            panic_with_error!(e, VaultError::ClaimNotCovered);
        }
        return refund_deposit(e, caller, epoch_id, request.amount);
    }

    request.claimed = true;
    state::set_deposit_request(e, epoch_id, caller, &request);
    state::set_pending_mint_shares(e, state::pending_mint_shares(e).saturating_sub(shares));

    let share_token = state::get_addr(e, &DataKey::ShareToken);
    ShareClient::new(e, &share_token).mint(caller, &shares, &e.current_contract_address());

    DepositClaimed {
        controller: caller.clone(),
        epoch: epoch_id,
        amount: request.amount,
        shares,
    }
    .publish(e);

    shares
}

/// Returns the settlement asset and clears the request. Used by cancellation and
/// by a claim whose conversion floors to zero.
fn refund_deposit(e: &Env, controller: &Address, epoch_id: u64, amount: i128) -> i128 {
    let mut epoch = state::get_epoch(e, epoch_id)
        .unwrap_or_else(|| panic_with_error!(e, VaultError::EpochNotFound));
    epoch.total_deposited -= amount;
    state::set_epoch(e, epoch_id, &epoch);
    state::remove_deposit_request(e, epoch_id, controller);

    let asset = state::get_addr(e, &DataKey::Asset);
    TokenClient::new(e, &asset).transfer(&e.current_contract_address(), controller, &amount);

    DepositCancelled {
        controller: controller.clone(),
        epoch: epoch_id,
        amount,
    }
    .publish(e);

    0
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

    let request = state::get_deposit_request(e, epoch_id, from)
        .unwrap_or_else(|| panic_with_error!(e, VaultError::RequestNotFound));

    state::set_cancellable_escrow(e, state::cancellable_escrow(e) - request.amount);
    refund_deposit(e, from, epoch_id, request.amount);
    request.amount
}
