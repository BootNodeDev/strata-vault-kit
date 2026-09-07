use bindings::ShareClient;
use soroban_sdk::{panic_with_error, Address, Env};

use crate::error::VaultError;
use crate::event::RedeemRequested;
use crate::keys::DataKey;
use crate::state::{self, RedeemRequest};

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
