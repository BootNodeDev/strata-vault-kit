use soroban_sdk::{panic_with_error, token::TokenClient, Address, Env};

use crate::error::VaultError;
use crate::event::{CustodianSet, Deployed, Funded};
use crate::keys::DataKey;
use crate::state;

pub(crate) fn set_custodian(e: &Env, custodian: &Address) {
    state::set_addr(e, &DataKey::Custodian, custodian);
    CustodianSet {
        custodian: custodian.clone(),
    }
    .publish(e);
}

fn held(e: &Env) -> i128 {
    let asset = state::get_addr(e, &DataKey::Asset);
    TokenClient::new(e, &asset).balance(&e.current_contract_address())
}

/// Assets held on-chain that are not already owed to a priced redemption.
/// What the vault holds less escrow the investor can still cancel.
pub(crate) fn liquid_reserve(e: &Env) -> i128 {
    held(e) - state::cancellable_escrow(e)
}

pub(crate) fn free_reserve(e: &Env) -> i128 {
    (liquid_reserve(e) - state::committed(e)).max(0)
}

/// Owed to holders beyond what the vault holds. Zero when every priced claim is
/// payable. While this is positive nothing may leave for the custodian.
pub(crate) fn uncovered(e: &Env) -> i128 {
    (state::committed(e) - liquid_reserve(e)).max(0)
}

pub(crate) fn deploy(e: &Env, assets: i128) -> i128 {
    if assets <= 0 {
        panic_with_error!(e, VaultError::InvalidAmount);
    }

    let custodian = state::get_addr_opt(e, &DataKey::Custodian)
        .unwrap_or_else(|| panic_with_error!(e, VaultError::CustodianNotSet));

    if assets > free_reserve(e) {
        panic_with_error!(e, VaultError::ReserveCommittedToExits);
    }

    let net_deployed = state::net_deployed(e)
        .checked_add(assets)
        .unwrap_or_else(|| panic_with_error!(e, VaultError::AmountTooLarge));
    state::set_net_deployed(e, net_deployed);

    let asset = state::get_addr(e, &DataKey::Asset);
    TokenClient::new(e, &asset).transfer(&e.current_contract_address(), &custodian, &assets);

    Deployed {
        custodian,
        assets,
        net_deployed,
    }
    .publish(e);

    net_deployed
}

pub(crate) fn fund(e: &Env, from: &Address, assets: i128) -> i128 {
    from.require_auth();

    if assets <= 0 {
        panic_with_error!(e, VaultError::InvalidAmount);
    }

    let net_deployed = state::net_deployed(e)
        .checked_sub(assets)
        .unwrap_or_else(|| panic_with_error!(e, VaultError::AmountTooLarge));
    state::set_net_deployed(e, net_deployed);

    let asset = state::get_addr(e, &DataKey::Asset);
    TokenClient::new(e, &asset).transfer(from, e.current_contract_address(), &assets);

    Funded {
        from: from.clone(),
        assets,
        net_deployed,
    }
    .publish(e);

    net_deployed
}
