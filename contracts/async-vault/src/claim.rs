use soroban_sdk::{panic_with_error, token::StellarAssetClient, Address, Env};

use crate::error::VaultError;
use crate::event::DepositClaimed;
use crate::keys::DataKey;
use crate::state::{self, EpochStatus};

pub(crate) fn deposit(e: &Env, caller: &Address, epoch_id: u64) -> i128 {
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

    let shares = request
        .amount
        .checked_div(epoch.share_price)
        .unwrap_or_else(|| panic_with_error!(e, VaultError::InvalidSharePrice));

    if shares == 0 {
        panic_with_error!(e, VaultError::NothingToClaim);
    }

    request.claimed = true;
    state::set_deposit_request(e, epoch_id, caller, &request);

    let share_token = state::get_addr(e, &DataKey::ShareToken);
    StellarAssetClient::new(e, &share_token).mint(caller, &shares);

    DepositClaimed {
        controller: caller.clone(),
        epoch: epoch_id,
        amount: request.amount,
        shares,
    }
    .publish(e);

    shares
}
