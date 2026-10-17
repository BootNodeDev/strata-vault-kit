use soroban_sdk::{contracttype, panic_with_error, Env};

use crate::error::VaultError;
use crate::event::EpochReconciled;
use crate::keys::DataKey;
use crate::state::{self, EpochStatus};

/// What pricing promised an epoch's requests and what has been paid against
/// it. Every claim floors, so the two drift apart by a few units; once the
/// last request settles the remainder leaves `pending_mint_shares` and
/// `committed`, and the cash stays in the reserve as fund money.
#[contracttype]
#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub struct EpochSettlement {
    pub deposits_open: u32,
    pub redeems_open: u32,
    pub shares_promised: i128,
    pub shares_settled: i128,
    pub assets_promised: i128,
    pub assets_settled: i128,
    pub reconciled: bool,
}

pub(crate) fn get(e: &Env, epoch: u64) -> Option<EpochSettlement> {
    storage::get_persistent(e, &DataKey::Settlement(epoch))
}

fn load(e: &Env, epoch: u64) -> EpochSettlement {
    get(e, epoch).unwrap_or_default()
}

fn save(e: &Env, epoch: u64, s: &EpochSettlement) {
    storage::set_persistent(e, &DataKey::Settlement(epoch), s);
}

fn close_one(e: &Env, open: u32) -> u32 {
    open.checked_sub(1)
        .unwrap_or_else(|| panic_with_error!(e, VaultError::AccountingMismatch))
}

pub(crate) fn on_deposit_requested(e: &Env, epoch: u64) {
    let mut s = load(e, epoch);
    s.deposits_open += 1;
    save(e, epoch, &s);
}

pub(crate) fn on_deposit_cancelled(e: &Env, epoch: u64) {
    let mut s = load(e, epoch);
    s.deposits_open = close_one(e, s.deposits_open);
    save(e, epoch, &s);
}

pub(crate) fn on_redeem_requested(e: &Env, epoch: u64) {
    let mut s = load(e, epoch);
    s.redeems_open += 1;
    save(e, epoch, &s);
}

pub(crate) fn on_redeem_cancelled(e: &Env, epoch: u64) {
    let mut s = load(e, epoch);
    s.redeems_open = close_one(e, s.redeems_open);
    save(e, epoch, &s);
}

/// Called once the epoch is stored as fulfilled.
pub(crate) fn on_priced(e: &Env, epoch: u64, shares_promised: i128, assets_promised: i128) {
    let mut s = load(e, epoch);
    s.shares_promised = shares_promised;
    s.assets_promised = assets_promised;
    reconcile_if_settled(e, epoch, &mut s);
    save(e, epoch, &s);
}

/// `shares` is zero for a claim that floored to nothing and was refunded.
pub(crate) fn on_deposit_claimed(e: &Env, epoch: u64, shares: i128) {
    let mut s = load(e, epoch);
    s.deposits_open = close_one(e, s.deposits_open);
    s.shares_settled += shares;
    reconcile_if_settled(e, epoch, &mut s);
    save(e, epoch, &s);
}

/// `assets` is zero for a claim that paid nothing and returned the shares.
pub(crate) fn on_redeem_claimed(e: &Env, epoch: u64, assets: i128) {
    let mut s = load(e, epoch);
    s.redeems_open = close_one(e, s.redeems_open);
    s.assets_settled += assets;
    reconcile_if_settled(e, epoch, &mut s);
    save(e, epoch, &s);
}

fn reconcile_if_settled(e: &Env, epoch: u64, s: &mut EpochSettlement) {
    if s.reconciled || s.deposits_open > 0 || s.redeems_open > 0 {
        return;
    }
    let priced = state::get_epoch(e, epoch).is_some_and(|ep| ep.status == EpochStatus::Fulfilled);
    if !priced {
        return;
    }
    let share_dust = state::reduce(e, s.shares_promised, s.shares_settled);
    let cash_dust = state::reduce(e, s.assets_promised, s.assets_settled);
    state::set_pending_mint_shares(
        e,
        state::reduce(e, state::pending_mint_shares(e), share_dust),
    );
    state::set_committed(e, state::reduce(e, state::committed(e), cash_dust));
    s.reconciled = true;

    EpochReconciled {
        epoch,
        share_dust,
        cash_dust,
    }
    .publish(e);
}
