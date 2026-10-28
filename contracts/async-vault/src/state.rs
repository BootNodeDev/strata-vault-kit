use soroban_sdk::{contracttype, panic_with_error, Address, Env};

use crate::error::VaultError;
use crate::keys::DataKey;

pub(crate) const FIRST_EPOCH: u64 = 1;

/// Takes `amount` off a running total that can never be negative. A result
/// below zero means the books disagree, so it fails loudly.
pub(crate) fn reduce(e: &Env, total: i128, amount: i128) -> i128 {
    match total.checked_sub(amount) {
        Some(left) if left >= 0 => left,
        _ => panic_with_error!(e, VaultError::AccountingMismatch),
    }
}

#[contracttype]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum EpochStatus {
    Open,
    Pending,
    Fulfilled,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct EpochInfo {
    pub status: EpochStatus,
    pub total_deposited: i128,
    pub total_shares_redeeming: i128,
    /// Assets per share, WAD-scaled: 1.0 is `WAD_SCALE`.
    pub share_price: i128,
    /// Ledger time the epoch closed. Zero while it is open.
    pub closed_at: u64,
    /// Ledger time the epoch can be priced, fixed when it closed from the
    /// notice standing then. Zero while it is open.
    pub priceable_at: u64,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct DepositRequest {
    pub amount: i128,
    pub claimed: bool,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RedeemRequest {
    pub shares: i128,
    pub claimed: bool,
}

pub(crate) fn set_addr(e: &Env, key: &DataKey, addr: &Address) {
    strata_storage::set_instance(e, key, addr);
}

pub(crate) fn get_addr(e: &Env, key: &DataKey) -> Address {
    strata_storage::get_instance(e, key)
        .unwrap_or_else(|| panic_with_error!(e, VaultError::NotInitialized))
}

pub(crate) fn get_addr_opt(e: &Env, key: &DataKey) -> Option<Address> {
    strata_storage::get_instance(e, key)
}

pub(crate) fn set_net_deployed(e: &Env, assets: i128) {
    strata_storage::set_instance(e, &DataKey::NetDeployed, &assets);
}

pub(crate) fn net_deployed(e: &Env) -> i128 {
    strata_storage::get_instance(e, &DataKey::NetDeployed).unwrap_or(0)
}

pub(crate) fn set_current_epoch(e: &Env, id: u64) {
    strata_storage::set_instance(e, &DataKey::CurrentEpoch, &id);
}

pub(crate) fn current_epoch(e: &Env) -> u64 {
    strata_storage::get_instance(e, &DataKey::CurrentEpoch)
        .unwrap_or_else(|| panic_with_error!(e, VaultError::NotInitialized))
}

pub(crate) fn set_notice(e: &Env, secs: u64) {
    strata_storage::set_instance(e, &DataKey::Notice, &secs);
}

/// Seconds an epoch waits after closing before it can be priced. Absent means
/// none, so a vault deployed without one behaves as it always did.
pub(crate) fn notice(e: &Env) -> u64 {
    strata_storage::get_instance(e, &DataKey::Notice).unwrap_or(0)
}

pub(crate) fn set_epoch_opened_at(e: &Env, at: u64) {
    strata_storage::set_instance(e, &DataKey::EpochOpenedAt, &at);
}

/// Ledger time the open epoch started. Absent before setup finishes, and on a
/// vault upgraded from a release that did not record it.
pub(crate) fn epoch_opened_at(e: &Env) -> Option<u64> {
    strata_storage::get_instance(e, &DataKey::EpochOpenedAt)
}

pub(crate) fn set_epoch(e: &Env, id: u64, epoch: &EpochInfo) {
    strata_storage::set_persistent(e, &DataKey::Epoch(id), epoch);
}

pub(crate) fn get_epoch(e: &Env, id: u64) -> Option<EpochInfo> {
    strata_storage::get_persistent(e, &DataKey::Epoch(id))
}

pub(crate) fn set_deposit_request(e: &Env, epoch: u64, holder: &Address, request: &DepositRequest) {
    strata_storage::set_persistent(e, &DataKey::UserDeposit(epoch, holder.clone()), request);
}

pub(crate) fn get_deposit_request(e: &Env, epoch: u64, holder: &Address) -> Option<DepositRequest> {
    strata_storage::get_persistent(e, &DataKey::UserDeposit(epoch, holder.clone()))
}

pub(crate) fn set_redeem_request(e: &Env, epoch: u64, holder: &Address, request: &RedeemRequest) {
    strata_storage::set_persistent(e, &DataKey::UserRedeem(epoch, holder.clone()), request);
}

pub(crate) fn get_redeem_request(e: &Env, epoch: u64, holder: &Address) -> Option<RedeemRequest> {
    strata_storage::get_persistent(e, &DataKey::UserRedeem(epoch, holder.clone()))
}

/// Cash owed to holders whose exit is priced but not yet claimed.
pub(crate) fn set_committed(e: &Env, assets: i128) {
    strata_storage::set_instance(e, &DataKey::Committed, &assets);
}

pub(crate) fn committed(e: &Env) -> i128 {
    strata_storage::get_instance(e, &DataKey::Committed).unwrap_or(0)
}

/// Deposit escrow across every unpriced epoch, still cancellable by the
/// investor. Pricing an epoch moves its share of this into the reserve.
pub(crate) fn set_cancellable_escrow(e: &Env, assets: i128) {
    strata_storage::set_instance(e, &DataKey::CancellableEscrow, &assets);
}

pub(crate) fn cancellable_escrow(e: &Env) -> i128 {
    strata_storage::get_instance(e, &DataKey::CancellableEscrow).unwrap_or(0)
}

pub(crate) fn remove_deposit_request(e: &Env, epoch: u64, holder: &Address) {
    e.storage()
        .persistent()
        .remove(&DataKey::UserDeposit(epoch, holder.clone()));
}

pub(crate) fn remove_redeem_request(e: &Env, epoch: u64, holder: &Address) {
    e.storage()
        .persistent()
        .remove(&DataKey::UserRedeem(epoch, holder.clone()));
}

pub(crate) fn set_pending_mint_shares(e: &Env, shares: i128) {
    strata_storage::set_instance(e, &DataKey::PendingMintShares, &shares);
}

pub(crate) fn pending_mint_shares(e: &Env) -> i128 {
    strata_storage::get_instance(e, &DataKey::PendingMintShares).unwrap_or(0)
}

pub(crate) fn set_pending_burn_shares(e: &Env, shares: i128) {
    strata_storage::set_instance(e, &DataKey::PendingBurnShares, &shares);
}

pub(crate) fn pending_burn_shares(e: &Env) -> i128 {
    strata_storage::get_instance(e, &DataKey::PendingBurnShares).unwrap_or(0)
}

pub(crate) fn deposit_cap(e: &Env) -> Option<i128> {
    strata_storage::get_instance(e, &DataKey::DepositCap)
}

pub(crate) fn set_deposit_cap(e: &Env, cap: Option<i128>) {
    match cap {
        Some(val) => strata_storage::set_instance(e, &DataKey::DepositCap, &val),
        None => e.storage().instance().remove(&DataKey::DepositCap),
    }
}
