use soroban_sdk::{panic_with_error, token::TokenClient, Address, Env};
use stellar_tokens::rwa::RWATokenClient;

use crate::epoch;
use crate::error::VaultError;
use crate::event::{DepositCancelled, DepositClaimed, DepositConvertedToExit, DepositRequested};
use crate::governance;
use crate::keys::DataKey;
use crate::lock_policy::{self, Decision, Exit, Standing};
use crate::pricing::{Pricing, PricingScheme};
use crate::redeem;
use crate::settlement;
use crate::state::{self, DepositRequest, EpochStatus};
use crate::treasury;
use crate::wind_down;

fn refuse_unless_allowed_in(e: &Env, holder: &Address) {
    let standing = lock_policy::standing(e, holder);
    if lock_policy::decide(Exit::RequestDeposit, standing, wind_down::is_active(e))
        != Decision::Proceed
    {
        panic_with_error!(e, lock_policy::refused_with(standing));
    }
}

fn refuse_if_exceeds_cap(e: &Env, amount: i128) {
    let Some(cap) = state::deposit_cap(e) else {
        return;
    };
    let current = treasury::deposited_capital(e);
    let new_total = current
        .checked_add(amount)
        .unwrap_or_else(|| panic_with_error!(e, VaultError::AmountTooLarge));
    if new_total > cap {
        panic_with_error!(e, VaultError::DepositCapExceeded);
    }
}

pub(crate) fn request(e: &Env, holder: &Address, amount: i128) -> u64 {
    wind_down::refuse_if_active(e);
    governance::refuse_if_setup_open(e);
    holder.require_auth();

    if amount <= 0 {
        panic_with_error!(e, VaultError::InvalidAmount);
    }
    refuse_unless_allowed_in(e, holder);
    refuse_if_exceeds_cap(e, amount);

    let epoch_id = state::current_epoch(e);

    if state::get_deposit_request(e, epoch_id, holder).is_some() {
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
        holder,
        &DepositRequest {
            amount,
            claimed: false,
        },
    );
    state::set_epoch(e, epoch_id, &epoch);
    let escrow = state::cancellable_escrow(e)
        .checked_add(amount)
        .unwrap_or_else(|| panic_with_error!(e, VaultError::AmountTooLarge));
    state::set_cancellable_escrow(e, escrow);
    settlement::on_deposit_requested(e, epoch_id);

    let asset = state::get_addr(e, &DataKey::Asset);
    TokenClient::new(e, &asset).transfer(holder, e.current_contract_address(), &amount);

    DepositRequested {
        holder: holder.clone(),
        epoch: epoch_id,
        amount,
    }
    .publish(e);

    epoch_id
}

pub(crate) fn claim(e: &Env, holder: &Address, epoch_id: u64) -> i128 {
    holder.require_auth();

    let epoch = state::get_epoch(e, epoch_id)
        .unwrap_or_else(|| panic_with_error!(e, VaultError::EpochNotFound));

    if epoch.status != EpochStatus::Fulfilled {
        panic_with_error!(e, VaultError::EpochNotFulfilled);
    }

    let mut request = state::get_deposit_request(e, epoch_id, holder)
        .unwrap_or_else(|| panic_with_error!(e, VaultError::RequestNotFound));

    if request.claimed {
        panic_with_error!(e, VaultError::AlreadyClaimed);
    }

    let standing = lock_policy::standing(e, holder);
    let decision = lock_policy::decide(Exit::ClaimDeposit, standing, wind_down::is_active(e));
    match decision {
        Decision::Proceed | Decision::ConvertToExit | Decision::Surrender => {}
        Decision::Refuse | Decision::Hold => {
            panic_with_error!(e, lock_policy::refused_with(standing))
        }
    }

    let shares = Pricing::deposit_shares(e, request.amount, epoch.share_price)
        .unwrap_or_else(|err| panic_with_error!(e, err));

    if shares == 0 {
        // Pricing already released this epoch's escrow into the reserve, so a
        // refund now is an extra payout rather than part of committed. It comes
        // out of free reserve and must not reach money owed to a priced exit.
        if treasury::free_reserve(e) < request.amount {
            panic_with_error!(e, VaultError::ClaimNotCovered);
        }
        refund_deposit(e, holder, epoch_id, request.amount);
        settlement::on_deposit_claimed(e, epoch_id, 0);
        return 0;
    }

    request.claimed = true;
    state::set_deposit_request(e, epoch_id, holder, &request);
    state::set_pending_mint_shares(e, state::reduce(e, state::pending_mint_shares(e), shares));

    if decision != Decision::Proceed {
        convert_to_exit(e, holder, epoch_id, shares, standing, decision);
        return 0;
    }

    let share_token = state::get_addr(e, &DataKey::ShareToken);
    RWATokenClient::new(e, &share_token).mint(holder, &shares, &e.current_contract_address());

    DepositClaimed {
        holder: holder.clone(),
        epoch: epoch_id,
        amount: request.amount,
        shares,
    }
    .publish(e);
    settlement::on_deposit_claimed(e, epoch_id, shares);

    shares
}

/// The holder is off the allowlist, so the shares exit in cash: next price, or the wind-down.
fn convert_to_exit(
    e: &Env,
    holder: &Address,
    epoch_id: u64,
    shares: i128,
    standing: Standing,
    decision: Decision,
) {
    let into_epoch = match decision {
        Decision::ConvertToExit => {
            let vault = e.current_contract_address();
            let share_token = state::get_addr(e, &DataKey::ShareToken);
            RWATokenClient::new(e, &share_token).mint(&vault, &shares, &vault);
            redeem::queue_escrowed(e, holder, shares)
        }
        Decision::Surrender => {
            wind_down::credit(e, holder, shares);
            0
        }
        Decision::Proceed | Decision::Refuse | Decision::Hold => {
            panic_with_error!(e, lock_policy::refused_with(standing))
        }
    };

    DepositConvertedToExit {
        holder: holder.clone(),
        epoch: epoch_id,
        into_epoch,
        shares,
    }
    .publish(e);
    settlement::on_deposit_claimed(e, epoch_id, shares);
}

/// Returns the settlement asset and clears the request. Used by cancellation and
/// by a claim whose conversion floors to zero.
fn refund_deposit(e: &Env, holder: &Address, epoch_id: u64, amount: i128) {
    let mut epoch = state::get_epoch(e, epoch_id)
        .unwrap_or_else(|| panic_with_error!(e, VaultError::EpochNotFound));
    epoch.total_deposited = state::reduce(e, epoch.total_deposited, amount);
    state::set_epoch(e, epoch_id, &epoch);
    state::remove_deposit_request(e, epoch_id, holder);

    let asset = state::get_addr(e, &DataKey::Asset);
    TokenClient::new(e, &asset).transfer(&e.current_contract_address(), holder, &amount);

    DepositCancelled {
        holder: holder.clone(),
        epoch: epoch_id,
        amount,
    }
    .publish(e);
}

pub(crate) fn cancel(e: &Env, holder: &Address, epoch_id: u64) -> i128 {
    holder.require_auth();

    let epoch = state::get_epoch(e, epoch_id)
        .unwrap_or_else(|| panic_with_error!(e, VaultError::EpochNotFound));

    if epoch.status == EpochStatus::Fulfilled {
        panic_with_error!(e, VaultError::AlreadyPriced);
    }

    // Cancellation is an escape hatch, not a choice. Once the feed can price a
    // sealed epoch, the price is knowable and the only way out is to take it.
    // Fulfilment is closed during a wind-down, so this epoch will never take a
    // price. There is nothing to decline.
    if !wind_down::is_active(e) && epoch::is_priceable(e, &epoch) {
        panic_with_error!(e, VaultError::PriceAvailable);
    }

    let request = state::get_deposit_request(e, epoch_id, holder)
        .unwrap_or_else(|| panic_with_error!(e, VaultError::RequestNotFound));

    let standing = lock_policy::standing(e, holder);
    match lock_policy::decide(Exit::CancelDeposit, standing, wind_down::is_active(e)) {
        Decision::Proceed => {}
        Decision::Refuse | Decision::Hold | Decision::ConvertToExit | Decision::Surrender => {
            panic_with_error!(e, lock_policy::refused_with(standing))
        }
    }

    state::set_cancellable_escrow(
        e,
        state::reduce(e, state::cancellable_escrow(e), request.amount),
    );
    settlement::on_deposit_cancelled(e, epoch_id);
    refund_deposit(e, holder, epoch_id, request.amount);
    request.amount
}
