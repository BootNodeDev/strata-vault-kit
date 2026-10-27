use soroban_sdk::{panic_with_error, token::TokenClient, Address, Env};
use stellar_tokens::rwa::RWATokenClient;

use crate::error::VaultError;
use crate::event::{DepositCancelled, DepositClaimed, DepositConvertedToExit, DepositRequested};
use crate::guards;
use crate::keys::DataKey;
use crate::lock_policy::{self, Decision, Exit, Standing};
use crate::pricing::{Pricing, PricingScheme};
use crate::redeem;
use crate::settlement;
use crate::state::{self, DepositRequest};
use crate::wind_down;

pub(crate) fn request(e: &Env, holder: &Address, amount: i128) -> u64 {
    guards::not_winding_down(e);
    guards::setup_finished(e);
    holder.require_auth();
    guards::positive_amount(e, amount);
    guards::allowed_to(e, Exit::RequestDeposit, holder);
    guards::within_cap(e, amount);
    let epoch_id = state::current_epoch(e);
    guards::no_open_deposit(e, epoch_id, holder);

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
    let mut request = state::get_deposit_request(e, epoch_id, holder)
        .unwrap_or_else(|| panic_with_error!(e, VaultError::RequestNotFound));
    guards::epoch_fulfilled(e, &epoch);
    guards::not_claimed(e, request.claimed);
    let standing = lock_policy::standing(e, holder);
    let decision = lock_policy::decide(Exit::ClaimDeposit, standing, wind_down::is_active(e));
    guards::not_refused(e, decision, standing);

    let shares = Pricing::deposit_shares(e, request.amount, epoch.share_price)
        .unwrap_or_else(|err| panic_with_error!(e, err));

    if shares == 0 {
        guards::refund_covered(e, request.amount);
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
    let request = state::get_deposit_request(e, epoch_id, holder)
        .unwrap_or_else(|| panic_with_error!(e, VaultError::RequestNotFound));
    guards::not_priced(e, &epoch);
    guards::no_price_available(e, &epoch);
    guards::allowed_to(e, Exit::CancelDeposit, holder);

    state::set_cancellable_escrow(
        e,
        state::reduce(e, state::cancellable_escrow(e), request.amount),
    );
    settlement::on_deposit_cancelled(e, epoch_id);
    refund_deposit(e, holder, epoch_id, request.amount);
    request.amount
}
