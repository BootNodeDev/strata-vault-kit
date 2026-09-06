use soroban_sdk::{panic_with_error, token::TokenClient, Address, Env};

use crate::error::VaultError;
use crate::event::DepositRequested;
use crate::keys::DataKey;
use crate::state::{self, DepositRequest, FIRST_EPOCH};

pub(crate) fn request(e: &Env, from: &Address, amount: i128) -> u64 {
    from.require_auth();

    if amount <= 0 {
        panic_with_error!(e, VaultError::InvalidAmount);
    }

    let epoch_id = FIRST_EPOCH;

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

pub(crate) fn request_of(e: &Env, epoch_id: u64, controller: &Address) -> Option<DepositRequest> {
    state::get_deposit_request(e, epoch_id, controller)
}
