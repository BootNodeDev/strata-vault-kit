use soroban_sdk::{contracttype, panic_with_error, Env};

use crate::error::VaultError;
use crate::event::EpochReconciled;
use crate::keys::DataKey;
use crate::state::{self, EpochStatus};

/// What pricing promised an epoch's requests and what has been paid against
/// it. Every claim floors, so the two drift apart by a few units. Once the
/// last deposit settles, the share remainder leaves `pending_mint_shares`;
/// once the last redemption settles, the cash remainder leaves `committed` and
/// stays in the reserve as fund money. Each side's flag records its release.
#[contracttype]
#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub struct EpochSettlement {
    pub deposits_open: u32,
    pub redeems_open: u32,
    pub shares_promised: i128,
    pub shares_settled: i128,
    pub assets_promised: i128,
    pub assets_settled: i128,
    pub shares_reconciled: bool,
    pub cash_reconciled: bool,
}

impl EpochSettlement {
    /// Both remainders have left the totals.
    pub(crate) fn reconciled(&self) -> bool {
        self.shares_reconciled && self.cash_reconciled
    }
}

pub(crate) fn get(e: &Env, epoch: u64) -> Option<EpochSettlement> {
    strata_storage::get_persistent(e, &DataKey::Settlement(epoch))
}

fn load(e: &Env, epoch: u64) -> EpochSettlement {
    get(e, epoch).unwrap_or_default()
}

fn save(e: &Env, epoch: u64, s: &EpochSettlement) {
    strata_storage::set_persistent(e, &DataKey::Settlement(epoch), s);
}

fn open_one(e: &Env, open: u32) -> u32 {
    open.checked_add(1)
        .unwrap_or_else(|| panic_with_error!(e, VaultError::AmountTooLarge))
}

fn close_one(e: &Env, open: u32) -> u32 {
    open.checked_sub(1)
        .unwrap_or_else(|| panic_with_error!(e, VaultError::AccountingMismatch))
}

fn add(e: &Env, total: i128, amount: i128) -> i128 {
    total
        .checked_add(amount)
        .unwrap_or_else(|| panic_with_error!(e, VaultError::AmountTooLarge))
}

pub(crate) fn on_deposit_requested(e: &Env, epoch: u64) {
    let mut s = load(e, epoch);
    s.deposits_open = open_one(e, s.deposits_open);
    save(e, epoch, &s);
}

pub(crate) fn on_deposit_cancelled(e: &Env, epoch: u64) {
    let mut s = load(e, epoch);
    s.deposits_open = close_one(e, s.deposits_open);
    save(e, epoch, &s);
}

pub(crate) fn on_redeem_requested(e: &Env, epoch: u64) {
    let mut s = load(e, epoch);
    s.redeems_open = open_one(e, s.redeems_open);
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
    s.shares_settled = add(e, s.shares_settled, shares);
    reconcile_if_settled(e, epoch, &mut s);
    save(e, epoch, &s);
}

/// `assets` is zero for a claim that paid nothing and returned the shares.
pub(crate) fn on_redeem_claimed(e: &Env, epoch: u64, assets: i128) {
    let mut s = load(e, epoch);
    s.redeems_open = close_one(e, s.redeems_open);
    s.assets_settled = add(e, s.assets_settled, assets);
    reconcile_if_settled(e, epoch, &mut s);
    save(e, epoch, &s);
}

/// Releases each side's remainder once that side has no open request, each
/// side once. The call that releases a remainder, or settles the epoch's last
/// request, publishes what it released.
fn reconcile_if_settled(e: &Env, epoch: u64, s: &mut EpochSettlement) {
    let shares_due = !s.shares_reconciled && s.deposits_open == 0;
    let cash_due = !s.cash_reconciled && s.redeems_open == 0;
    if !shares_due && !cash_due {
        return;
    }
    let priced = state::get_epoch(e, epoch).is_some_and(|ep| ep.status == EpochStatus::Fulfilled);
    if !priced {
        return;
    }

    let mut share_dust = 0;
    if shares_due {
        share_dust = state::reduce(e, s.shares_promised, s.shares_settled);
        state::set_pending_mint_shares(
            e,
            state::reduce(e, state::pending_mint_shares(e), share_dust),
        );
        s.shares_reconciled = true;
    }
    let mut cash_dust = 0;
    if cash_due {
        cash_dust = state::reduce(e, s.assets_promised, s.assets_settled);
        state::set_committed(e, state::reduce(e, state::committed(e), cash_dust));
        s.cash_reconciled = true;
    }

    if share_dust > 0 || cash_dust > 0 || s.reconciled() {
        EpochReconciled {
            epoch,
            share_dust,
            cash_dust,
        }
        .publish(e);
    }
}
