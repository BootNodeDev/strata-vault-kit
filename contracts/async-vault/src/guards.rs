use soroban_sdk::{panic_with_error, Address, Env, Symbol};
use stellar_access::{access_control::AccessControlStorageKey, role_transfer};
use stellar_tokens::{
    fungible::FungibleTokenClient,
    rwa::{compliance::ComplianceClient as RulesClient, RWATokenClient},
};
use strata_timelock::{queue, setup};

use crate::epoch;
use crate::error::VaultError;
use crate::governance::{self, VaultChange};
use crate::keys::DataKey;
use crate::lock_policy::{self, Decision, Exit, Standing};
use crate::roles::{VaultRoles, MANAGER_ROLE};
use crate::state::{self, EpochInfo, EpochStatus};
use crate::treasury;
use crate::upgrade::{self, MAX_UPGRADE_DELAY, MIN_UPGRADE_DELAY};
use crate::wind_down::{
    self, WindDownInfo, WindDownStatus, MAX_WIND_DOWN_DELAY, MIN_WIND_DOWN_DELAY,
};
use crate::MAX_NOTICE_SECS;

pub(crate) fn roles_distinct(e: &Env, roles: &VaultRoles) {
    if roles.treasury == roles.guardian
        || roles.treasury == roles.governance
        || roles.compliance == roles.governance
        || roles.compliance == roles.treasury
    {
        panic_with_error!(e, VaultError::RolesNotDistinct);
    }
}

/// Called at the top of every entrypoint the wind-down closes.
pub(crate) fn not_winding_down(e: &Env) {
    if wind_down::is_active(e) {
        panic_with_error!(e, VaultError::WindDownActive);
    }
}

pub(crate) fn winding_down(e: &Env) {
    if !wind_down::is_active(e) {
        panic_with_error!(e, VaultError::WindDownNotActive);
    }
}

/// Nothing is taken in or queued until every admin change on the kit waits for
/// the timelock.
pub(crate) fn setup_finished(e: &Env) {
    if setup::is_open(e) {
        panic_with_error!(e, VaultError::SetupOpen);
    }
}

pub(crate) fn setup_open(e: &Env) {
    if !setup::is_open(e) {
        panic_with_error!(e, VaultError::SetupClosed);
    }
}

/// Direct admin calls are instant only before setup finishes.
pub(crate) fn direct_change_allowed(e: &Env) {
    if !setup::is_open(e) {
        panic_with_error!(e, VaultError::UseTimelock);
    }
}

/// After setup, revoking `manager` waits like a grant; any other revoke stays
/// instant.
pub(crate) fn direct_revoke_allowed(e: &Env, role: &Symbol) {
    if *role == MANAGER_ROLE {
        direct_change_allowed(e);
    }
}

/// Only an offer needs setup open; cancelling one (`0`) keeps the admin.
pub(crate) fn direct_hand_over_allowed(e: &Env, live_until_ledger: u32) {
    if live_until_ledger != 0 {
        direct_change_allowed(e);
    }
}

pub(crate) fn not_lowered_after_setup(e: &Env, new: u64, current: u64) {
    if new < current {
        direct_change_allowed(e);
    }
}

/// No nominee from setup may accept once changes wait, so a hand-over offered
/// during setup holds it open.
pub(crate) fn no_hand_over_pending(e: &Env) {
    if role_transfer::has_active_pending_transfer(e, &AccessControlStorageKey::PendingAdmin) {
        panic_with_error!(e, VaultError::AdminTransferPending);
    }
}

pub(crate) fn wiring_complete(e: &Env) {
    if !governance::wiring(e).complete() {
        panic_with_error!(e, VaultError::SetupIncomplete);
    }
}

pub(crate) fn non_negative_cap(e: &Env, cap: Option<i128>) {
    if cap.is_some_and(|cap| cap < 0) {
        panic_with_error!(e, VaultError::InvalidAmount);
    }
}

pub(crate) fn notice_in_bounds(e: &Env, secs: u64) {
    if secs > MAX_NOTICE_SECS {
        panic_with_error!(e, VaultError::NoticeTooLong);
    }
    if secs > upgrade::delay(e) {
        panic_with_error!(e, VaultError::NoticeAboveUpgradeDelay);
    }
}

#[cfg_attr(feature = "short_wind_down", allow(clippy::absurd_extreme_comparisons))]
pub(crate) fn wind_down_delay_in_bounds(e: &Env, secs: u64) {
    if secs < MIN_WIND_DOWN_DELAY {
        panic_with_error!(e, VaultError::WindDownDelayTooShort);
    }
    if secs > MAX_WIND_DOWN_DELAY {
        panic_with_error!(e, VaultError::WindDownDelayTooLong);
    }
}

/// An exit takes a full notice, so a delay shorter than one is not a window.
pub(crate) fn upgrade_delay_in_bounds(e: &Env, secs: u64) {
    if secs < MIN_UPGRADE_DELAY {
        panic_with_error!(e, VaultError::UpgradeDelayTooShort);
    }
    if secs > MAX_UPGRADE_DELAY {
        panic_with_error!(e, VaultError::UpgradeDelayTooLong);
    }
    if secs < state::notice(e) {
        panic_with_error!(e, VaultError::UpgradeDelayBelowNotice);
    }
}

pub(crate) fn feed_bound_here(e: &Env, feed: &Address) {
    if !governance::bound_here(e, feed) {
        panic_with_error!(e, VaultError::FeedNotBound);
    }
}

/// The bounds a change must meet when it is proposed and again when it
/// applies.
pub(crate) fn change_in_bounds(e: &Env, change: &VaultChange) {
    match change {
        VaultChange::UpgradeDelay(secs) => upgrade_delay_in_bounds(e, *secs),
        VaultChange::Notice(secs) => notice_in_bounds(e, *secs),
        VaultChange::WindDownDelay(secs) => wind_down_delay_in_bounds(e, *secs),
        VaultChange::Oracle(feed) => feed_bound_here(e, feed),
        VaultChange::Upgrade(_)
        | VaultChange::Custodian(_)
        | VaultChange::GrantRole(..)
        | VaultChange::RevokeRole(..)
        | VaultChange::Admin(_) => {}
    }
}

/// One code change at a time, so a standing eta is never quietly replaced.
pub(crate) fn no_code_change_pending(e: &Env, change: &VaultChange) {
    if changes_code(change) && code_change_pending(e) {
        panic_with_error!(e, VaultError::UpgradeProposalExists);
    }
}

fn changes_code(change: &VaultChange) -> bool {
    matches!(
        change,
        VaultChange::Upgrade(_) | VaultChange::UpgradeDelay(_)
    )
}

fn code_change_pending(e: &Env) -> bool {
    queue::open_ids(e).iter().any(|id| {
        queue::pending::<VaultChange>(e, id).is_some_and(|(change, _)| changes_code(&change))
    })
}

pub(crate) fn no_wind_down_proposed(e: &Env) {
    if matches!(
        wind_down::info(e),
        Some(WindDownInfo {
            status: WindDownStatus::Proposed,
            ..
        })
    ) {
        panic_with_error!(e, VaultError::WindDownAlreadyProposed);
    }
}

pub(crate) fn wind_down_proposed(e: &Env) {
    if !matches!(
        wind_down::info(e),
        Some(WindDownInfo {
            status: WindDownStatus::Proposed,
            ..
        })
    ) {
        panic_with_error!(e, VaultError::WindDownNotProposed);
    }
}

pub(crate) fn wind_down_delay_elapsed(e: &Env, proposal: &WindDownInfo) {
    if e.ledger().timestamp() < proposal.active_at {
        panic_with_error!(e, VaultError::WindDownDelayNotElapsed);
    }
}

pub(crate) fn distribution_started(e: &Env) {
    if wind_down::info(e).map(|wd| wd.round).unwrap_or(0) == 0 {
        panic_with_error!(e, VaultError::DistributionNotStarted);
    }
}

/// A round needs a supply to divide by and a pot that credits something.
pub(crate) fn something_to_distribute(e: &Env, value: i128) {
    if value <= 0 {
        panic_with_error!(e, VaultError::NothingToDistribute);
    }
}

pub(crate) fn has_entitlement(e: &Env, surrendered: i128, assets: i128) {
    if surrendered == 0 && assets == 0 {
        panic_with_error!(e, VaultError::NoEntitlement);
    }
}

pub(crate) fn positive_amount(e: &Env, amount: i128) {
    if amount <= 0 {
        panic_with_error!(e, VaultError::InvalidAmount);
    }
}

pub(crate) fn within_cap(e: &Env, amount: i128) {
    let Some(cap) = state::deposit_cap(e) else {
        return;
    };
    let new_total = treasury::deposited_capital(e)
        .checked_add(amount)
        .unwrap_or_else(|| panic_with_error!(e, VaultError::AmountTooLarge));
    if new_total > cap {
        panic_with_error!(e, VaultError::DepositCapExceeded);
    }
}

pub(crate) fn within_free_reserve(e: &Env, assets: i128) {
    if assets > treasury::free_reserve(e) {
        panic_with_error!(e, VaultError::ReserveCommittedToExits);
    }
}

pub(crate) fn no_open_deposit(e: &Env, epoch_id: u64, holder: &Address) {
    if state::get_deposit_request(e, epoch_id, holder).is_some() {
        panic_with_error!(e, VaultError::RequestOutstanding);
    }
}

pub(crate) fn no_open_redeem(e: &Env, epoch_id: u64, holder: &Address) {
    if state::get_redeem_request(e, epoch_id, holder).is_some() {
        panic_with_error!(e, VaultError::RequestOutstanding);
    }
}

pub(crate) fn not_claimed(e: &Env, claimed: bool) {
    if claimed {
        panic_with_error!(e, VaultError::AlreadyClaimed);
    }
}

/// A request within the balance but short of the free shares needs frozen
/// ones; beyond the balance entirely, the token's own check applies instead.
pub(crate) fn needs_no_frozen_shares(e: &Env, holder: &Address, shares: i128) {
    if shares > lock_policy::free_shares(e, holder) {
        let held =
            FungibleTokenClient::new(e, &state::get_addr(e, &DataKey::ShareToken)).balance(holder);
        if shares <= held {
            panic_with_error!(e, VaultError::Frozen);
        }
    }
}

/// Pricing already released the epoch's escrow into the reserve, so a refund
/// is an extra payout rather than part of committed. It comes out of free
/// reserve and must not reach money owed to a priced exit.
pub(crate) fn refund_covered(e: &Env, amount: i128) {
    if treasury::free_reserve(e) < amount {
        panic_with_error!(e, VaultError::ClaimNotCovered);
    }
}

/// Against liquid reserve, not the raw balance: escrow a depositor can still
/// cancel is not available to pay an exit.
pub(crate) fn payout_covered(e: &Env, assets: i128) {
    if treasury::liquid_reserve(e) < assets {
        panic_with_error!(e, VaultError::ClaimNotCovered);
    }
}

/// The holder may hold shares and the compliance rules let the vault send them.
pub(crate) fn eligible_to_receive(e: &Env, holder: &Address, shares: i128) {
    let vault = e.current_contract_address();
    let token = state::get_addr(e, &DataKey::ShareToken);
    let share = RWATokenClient::new(e, &token);
    if lock_policy::standing(e, holder) != Standing::Listed
        || !RulesClient::new(e, &share.compliance()).can_transfer(&vault, holder, &shares, &token)
    {
        panic_with_error!(e, VaultError::HolderNotEligible);
    }
}

pub(crate) fn epoch_open(e: &Env, epoch: &EpochInfo) {
    if epoch.status != EpochStatus::Open {
        panic_with_error!(e, VaultError::EpochNotOpen);
    }
}

pub(crate) fn epoch_fulfilled(e: &Env, epoch: &EpochInfo) {
    if epoch.status != EpochStatus::Fulfilled {
        panic_with_error!(e, VaultError::EpochNotFulfilled);
    }
}

pub(crate) fn not_priced(e: &Env, epoch: &EpochInfo) {
    if epoch.status == EpochStatus::Fulfilled {
        panic_with_error!(e, VaultError::AlreadyPriced);
    }
}

/// Cancellation is an escape hatch, not a choice. Once the feed can price a
/// sealed epoch, the price is knowable and the only way out is to take it.
/// Fulfilment is closed during a wind-down, so this epoch will never take a
/// price. There is nothing to decline.
pub(crate) fn no_price_available(e: &Env, epoch: &EpochInfo) {
    if !wind_down::is_active(e) && epoch::is_priceable(e, epoch) {
        panic_with_error!(e, VaultError::PriceAvailable);
    }
}

pub(crate) fn fulfilable(e: &Env, epoch: &EpochInfo) {
    if let Err(refusal) = epoch::fulfilable(e, epoch) {
        panic_with_error!(e, refusal);
    }
}

/// The lock policy lets the holder's `exit` go ahead as asked.
pub(crate) fn allowed_to(e: &Env, exit: Exit, holder: &Address) {
    let standing = lock_policy::standing(e, holder);
    if lock_policy::decide(exit, standing, wind_down::is_active(e)) != Decision::Proceed {
        panic_with_error!(e, lock_policy::refused_with(standing));
    }
}

/// The lock policy neither refuses nor holds the exit: it goes ahead, or its
/// value moves to an exit.
pub(crate) fn not_refused(e: &Env, decision: Decision, standing: Standing) {
    if matches!(decision, Decision::Refuse | Decision::Hold) {
        panic_with_error!(e, lock_policy::refused_with(standing));
    }
}
