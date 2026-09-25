use bindings::{OracleFeedClient, OracleState};
use soroban_sdk::{panic_with_error, Env};

use crate::error::VaultError;
use crate::event::{EpochClosed, EpochFulfilled};
use crate::keys::DataKey;
use crate::pricing::{Pricing, PricingScheme};
use crate::state::{self, EpochInfo, EpochStatus};
use crate::timing::{FulfilmentTiming, StandardTiming};
use crate::wind_down;

/// The schedule this vault fulfils on.
type Timing = StandardTiming;

pub(crate) fn open(total_deposited: i128) -> EpochInfo {
    EpochInfo {
        status: EpochStatus::Open,
        total_deposited,
        total_shares_redeeming: 0,
        share_price: 0,
        closed_at: 0,
        priceable_at: 0,
    }
}

/// The feed is usable and its standing valuation is no older than the close.
/// Deliberately excludes the notice: see `is_priceable`.
fn price_readable(e: &Env, epoch: &EpochInfo) -> Result<(), VaultError> {
    let feed = OracleFeedClient::new(e, &state::get_addr(e, &DataKey::Oracle));
    if feed.state() != OracleState::Valid {
        return Err(VaultError::FeedNotValid);
    }
    if !Timing::price_is_current(epoch.closed_at, feed.attested_at()) {
        return Err(VaultError::AttestationBeforeClose);
    }
    Ok(())
}

/// Every condition pricing an epoch requires. It answers rather than aborting,
/// so the cancellation window and fulfilment are decided by the same code.
pub(crate) fn fulfilable(e: &Env, epoch: &EpochInfo) -> Result<(), VaultError> {
    if epoch.status != EpochStatus::Pending {
        return Err(VaultError::EpochNotPending);
    }
    if !Timing::notice_elapsed(e.ledger().timestamp(), epoch.priceable_at) {
        return Err(VaultError::NoticeNotElapsed);
    }
    price_readable(e, epoch)
}

/// True when the epoch's price can already be read, which is what closes the
/// cancellation window: cancelling after this would be declining a price the
/// investor has seen.
pub(crate) fn is_priceable(e: &Env, epoch: &EpochInfo) -> bool {
    epoch.status == EpochStatus::Pending && price_readable(e, epoch).is_ok()
}

pub(crate) fn close(e: &Env) -> u64 {
    wind_down::refuse_if_active(e);
    let current = state::current_epoch(e);
    let mut epoch = state::get_epoch(e, current)
        .unwrap_or_else(|| panic_with_error!(e, VaultError::EpochNotFound));

    if epoch.status != EpochStatus::Open {
        panic_with_error!(e, VaultError::EpochNotOpen);
    }

    let next = current
        .checked_add(1)
        .unwrap_or_else(|| panic_with_error!(e, VaultError::EpochOverflow));

    let closed_at = e.ledger().timestamp();

    epoch.status = EpochStatus::Pending;
    epoch.closed_at = closed_at;
    epoch.priceable_at = Timing::priceable_at(closed_at, state::notice(e));
    state::set_epoch(e, current, &epoch);

    state::set_epoch(e, next, &open(0));
    state::set_current_epoch(e, next);

    EpochClosed {
        epoch: current,
        total_deposited: epoch.total_deposited,
        total_shares_redeeming: epoch.total_shares_redeeming,
    }
    .publish(e);

    current
}

pub(crate) fn fulfill(e: &Env, epoch_id: u64) -> i128 {
    wind_down::refuse_if_active(e);
    let mut epoch = state::get_epoch(e, epoch_id)
        .unwrap_or_else(|| panic_with_error!(e, VaultError::EpochNotFound));

    if let Err(refusal) = fulfilable(e, &epoch) {
        panic_with_error!(e, refusal);
    }

    let share_price =
        Pricing::resolve_share_price(e).unwrap_or_else(|err| panic_with_error!(e, err));

    let owed = Pricing::redeem_assets(e, epoch.total_shares_redeeming, share_price)
        .unwrap_or_else(|err| panic_with_error!(e, err));
    let committed = state::committed(e)
        .checked_add(owed)
        .unwrap_or_else(|| panic_with_error!(e, VaultError::AmountTooLarge));
    state::set_committed(e, committed);

    if epoch.total_deposited > 0 {
        let shares_owed = Pricing::deposit_shares(e, epoch.total_deposited, share_price)
            .unwrap_or_else(|err| panic_with_error!(e, err));
        let updated_pending_mint = state::pending_mint_shares(e)
            .checked_add(shares_owed)
            .unwrap_or_else(|| panic_with_error!(e, VaultError::AmountTooLarge));
        state::set_pending_mint_shares(e, updated_pending_mint);
    }

    if epoch.total_shares_redeeming > 0 {
        let updated_pending_burn = state::pending_burn_shares(e)
            .checked_add(epoch.total_shares_redeeming)
            .unwrap_or_else(|| panic_with_error!(e, VaultError::AmountTooLarge));
        state::set_pending_burn_shares(e, updated_pending_burn);
    }

    state::set_cancellable_escrow(e, state::cancellable_escrow(e) - epoch.total_deposited);

    epoch.status = EpochStatus::Fulfilled;
    epoch.share_price = share_price;
    state::set_epoch(e, epoch_id, &epoch);

    EpochFulfilled {
        epoch: epoch_id,
        share_price,
        total_deposited: epoch.total_deposited,
    }
    .publish(e);

    share_price
}
