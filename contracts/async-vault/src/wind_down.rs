use soroban_sdk::{contracttype, panic_with_error, token::TokenClient, Address, Env};
use stellar_contract_utils::math::{i128_fixed_point::checked_mul_div_floor, wad::WAD_SCALE};
use stellar_tokens::{fungible::FungibleTokenClient, rwa::RWATokenClient};

use crate::error::VaultError;
use crate::event::{
    WindDownActivated, WindDownClaimed, WindDownDelaySet, WindDownProposalCancelled,
    WindDownProposed, WindDownRoundFinalized,
};
use crate::guards;
use crate::keys::DataKey;
use crate::lock_policy::{self, Exit, Standing};
use crate::state;
use crate::treasury;

/// Ninety days. Long enough for a real announcement period, short enough that
/// governance cannot set a delay the vault would never outlive.
pub const MAX_WIND_DOWN_DELAY: u64 = 90 * strata_timelock::DAY_DURATION;

/// Seven days: holders always get a week's warning before a wind-down starts.
/// It is also the delay when none was set.
#[cfg(not(feature = "short_wind_down"))]
pub const MIN_WIND_DOWN_DELAY: u64 = 7 * strata_timelock::DAY_DURATION;
/// The local harness build activates a wind-down at once.
#[cfg(feature = "short_wind_down")]
pub const MIN_WIND_DOWN_DELAY: u64 = 0;

#[contracttype]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum WindDownStatus {
    Proposed,
    Active,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct WindDownInfo {
    pub status: WindDownStatus,
    /// Ledger time the proposal may be activated.
    pub active_at: u64,
    /// Rounds finalised so far. Zero means no snapshot has been taken.
    pub round: u32,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct WindDownPosition {
    pub entitlement: i128,
    /// Assets already paid against that entitlement.
    pub paid: i128,
}

pub(crate) fn delay(e: &Env) -> u64 {
    strata_storage::get_instance(e, &DataKey::WindDownDelay).unwrap_or(MIN_WIND_DOWN_DELAY)
}

pub(crate) fn set_delay(e: &Env, secs: u64) {
    strata_storage::set_instance(e, &DataKey::WindDownDelay, &secs);
    WindDownDelaySet { secs }.publish(e);
}

pub(crate) fn info(e: &Env) -> Option<WindDownInfo> {
    strata_storage::get_instance(e, &DataKey::WindDown)
}

pub(crate) fn is_active(e: &Env) -> bool {
    match info(e) {
        Some(WindDownInfo {
            status: WindDownStatus::Active,
            ..
        }) => true,
        Some(WindDownInfo {
            status: WindDownStatus::Proposed,
            ..
        })
        | None => false,
    }
}

pub(crate) fn propose(e: &Env) {
    guards::not_winding_down(e);
    guards::no_wind_down_proposed(e);

    let active_at = e.ledger().timestamp().saturating_add(delay(e));
    strata_storage::set_instance(
        e,
        &DataKey::WindDown,
        &WindDownInfo {
            status: WindDownStatus::Proposed,
            active_at,
            round: 0,
        },
    );

    WindDownProposed { active_at }.publish(e);
}

pub(crate) fn cancel_proposal(e: &Env) {
    guards::not_winding_down(e);
    guards::wind_down_proposed(e);

    e.storage().instance().remove(&DataKey::WindDown);
    WindDownProposalCancelled {}.publish(e);
}

pub(crate) fn activate(e: &Env) {
    let mut wd = info(e).unwrap_or_else(|| panic_with_error!(e, VaultError::WindDownNotProposed));
    guards::not_winding_down(e);
    guards::wind_down_delay_elapsed(e, &wd);

    wd.status = WindDownStatus::Active;
    strata_storage::set_instance(e, &DataKey::WindDown, &wd);

    WindDownActivated {}.publish(e);
}

pub(crate) fn owed(e: &Env) -> i128 {
    strata_storage::get_instance(e, &DataKey::WindDownOwed).unwrap_or(0)
}

pub(crate) fn acc(e: &Env) -> i128 {
    strata_storage::get_instance(e, &DataKey::WindDownAcc).unwrap_or(0)
}

pub(crate) fn supply_snapshot(e: &Env) -> i128 {
    strata_storage::get_instance(e, &DataKey::WindDownSupply).unwrap_or(0)
}

fn credited_before_snapshot(e: &Env) -> i128 {
    strata_storage::get_instance(e, &DataKey::WindDownCredited).unwrap_or(0)
}

/// Shares that exist or are owed: circulating, escrowed against an unpriced
/// redemption, owed by a deposit that has been priced but not claimed, and
/// credited straight to a holder's entitlement.
fn snapshot_supply(e: &Env) -> i128 {
    let share_token = state::get_addr(e, &DataKey::ShareToken);
    let total_supply = FungibleTokenClient::new(e, &share_token).total_supply();
    state::reduce(e, total_supply, state::pending_burn_shares(e))
        .checked_add(state::pending_mint_shares(e))
        .and_then(|supply| supply.checked_add(credited_before_snapshot(e)))
        .unwrap_or_else(|| panic_with_error!(e, VaultError::AmountTooLarge))
}

/// Shares credited before the first round are counted into its snapshot, having left the supply.
pub(crate) fn credit(e: &Env, holder: &Address, shares: i128) {
    let mut p = position(e, holder);
    p.entitlement = p
        .entitlement
        .checked_add(shares)
        .unwrap_or_else(|| panic_with_error!(e, VaultError::AmountTooLarge));
    strata_storage::set_persistent(e, &DataKey::WindDownPosition(holder.clone()), &p);

    if info(e).map(|wd| wd.round).unwrap_or(0) == 0 {
        let credited = credited_before_snapshot(e)
            .checked_add(shares)
            .unwrap_or_else(|| panic_with_error!(e, VaultError::AmountTooLarge));
        strata_storage::set_instance(e, &DataKey::WindDownCredited, &credited);
    }
}

pub(crate) fn finalize_round(e: &Env) -> i128 {
    let mut wd = info(e).unwrap_or_else(|| panic_with_error!(e, VaultError::WindDownNotActive));
    guards::winding_down(e);

    let snapshot = if wd.round == 0 {
        let s = snapshot_supply(e);
        strata_storage::set_instance(e, &DataKey::WindDownSupply, &s);
        s
    } else {
        supply_snapshot(e)
    };
    guards::something_to_distribute(e, snapshot);

    let pot = treasury::free_reserve(e);
    let delta = checked_mul_div_floor(e, &pot, &WAD_SCALE, &snapshot)
        .unwrap_or_else(|| panic_with_error!(e, VaultError::AmountTooLarge));
    guards::something_to_distribute(e, delta);

    let acc_before = acc(e);
    let acc_per_share = acc_before
        .checked_add(delta)
        .unwrap_or_else(|| panic_with_error!(e, VaultError::AmountTooLarge));

    // The most every holder together can ever claim is floor(supply * acc / WAD).
    // Crediting the growth of that figure, rather than this round's own floor,
    // keeps owed at or above every payout the accumulator can produce.
    let promised = |acc_value: &i128| {
        checked_mul_div_floor(e, &snapshot, acc_value, &WAD_SCALE)
            .unwrap_or_else(|| panic_with_error!(e, VaultError::AmountTooLarge))
    };
    let credited = promised(&acc_per_share) - promised(&acc_before);

    let owed_total = owed(e)
        .checked_add(credited)
        .unwrap_or_else(|| panic_with_error!(e, VaultError::AmountTooLarge));
    strata_storage::set_instance(e, &DataKey::WindDownAcc, &acc_per_share);
    strata_storage::set_instance(e, &DataKey::WindDownOwed, &owed_total);

    wd.round += 1;
    strata_storage::set_instance(e, &DataKey::WindDown, &wd);

    WindDownRoundFinalized {
        round: wd.round,
        pot,
        credited,
        acc_per_share,
    }
    .publish(e);

    credited
}

pub(crate) fn position(e: &Env, holder: &Address) -> WindDownPosition {
    strata_storage::get_persistent(e, &DataKey::WindDownPosition(holder.clone())).unwrap_or(
        WindDownPosition {
            entitlement: 0,
            paid: 0,
        },
    )
}

/// What this holder would be paid if they claimed now, surrendering the free
/// shares they hold. Zero for a fully frozen holder, whom `claim` refuses.
pub(crate) fn claimable(e: &Env, holder: &Address) -> i128 {
    if info(e).map(|wd| wd.round).unwrap_or(0) == 0 {
        return 0;
    }
    if lock_policy::standing(e, holder) == Standing::Frozen {
        return 0;
    }

    let held = lock_policy::free_shares(e, holder);
    let p = position(e, holder);
    let entitlement = p.entitlement.saturating_add(held);

    checked_mul_div_floor(e, &entitlement, &acc(e), &WAD_SCALE)
        .map(|earned| earned - p.paid)
        .unwrap_or_else(|| panic_with_error!(e, VaultError::AmountTooLarge))
}

pub(crate) fn claim(e: &Env, holder: &Address) -> i128 {
    holder.require_auth();
    guards::distribution_started(e);
    guards::allowed_to(e, Exit::ClaimWindDown, holder);

    let vault = e.current_contract_address();
    let share_token = state::get_addr(e, &DataKey::ShareToken);

    // A partial freeze keeps its shares out of the surrender; they earn every
    // round regardless, and are paid once unfrozen and claimed again.
    let surrendered = lock_policy::free_shares(e, holder);
    let mut p = position(e, holder);
    p.entitlement = p
        .entitlement
        .checked_add(surrendered)
        .unwrap_or_else(|| panic_with_error!(e, VaultError::AmountTooLarge));

    let earned = checked_mul_div_floor(e, &p.entitlement, &acc(e), &WAD_SCALE)
        .unwrap_or_else(|| panic_with_error!(e, VaultError::AmountTooLarge));
    let assets = earned - p.paid;
    guards::has_entitlement(e, surrendered, assets);

    p.paid = earned;
    strata_storage::set_persistent(e, &DataKey::WindDownPosition(holder.clone()), &p);

    if surrendered > 0 {
        RWATokenClient::new(e, &share_token).burn(holder, &surrendered, &vault);
    }

    if assets > 0 {
        strata_storage::set_instance(
            e,
            &DataKey::WindDownOwed,
            &state::reduce(e, owed(e), assets),
        );
        let asset = state::get_addr(e, &DataKey::Asset);
        TokenClient::new(e, &asset).transfer(&vault, holder, &assets);
    }

    WindDownClaimed {
        holder: holder.clone(),
        surrendered,
        assets,
    }
    .publish(e);

    assets
}
