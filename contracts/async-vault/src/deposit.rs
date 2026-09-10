use bindings::ShareClient;
use soroban_sdk::{panic_with_error, token::TokenClient, Address, Env};
use stellar_contract_utils::math::{i128_fixed_point::checked_mul_div_floor, wad::WAD_SCALE};

use crate::error::VaultError;
use crate::event::{DepositClaimed, DepositRequested};
use crate::keys::DataKey;
use crate::state::{self, DepositRequest, EpochStatus};

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
        panic_with_error!(e, VaultError::NothingToClaim);
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
