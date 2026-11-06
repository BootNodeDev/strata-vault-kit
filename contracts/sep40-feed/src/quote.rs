use sep40::{Asset, PriceData};
use soroban_sdk::{token::TokenClient, Env};
use strata_bindings::{
    OracleFeedClient, OracleState, VaultViewClient, WindDownInfo, WindDownStatus,
};

use crate::bound_vault;
use crate::price::{share_price, ONE};

/// `Ok(Ok(value))` only; any other shape of a `try_` call reads as absent.
fn ok<T, E>(
    result: Result<Result<T, E>, Result<soroban_sdk::Error, soroban_sdk::InvokeError>>,
) -> Option<T> {
    match result {
        Ok(Ok(value)) => Some(value),
        _ => None,
    }
}

fn winding_down(wind_down: &Option<WindDownInfo>) -> bool {
    matches!(
        wind_down,
        Some(WindDownInfo {
            status: WindDownStatus::Active,
            ..
        })
    )
}

/// The latest price of `asset` and the oracle it came from, so a caller that
/// also needs the oracle's own state reads it once, not twice.
fn quote<'a>(e: &'a Env, asset: &Asset) -> Option<(PriceData, OracleFeedClient<'a>)> {
    let vault = VaultViewClient::new(e, &bound_vault(e));
    let share_token = ok(vault.try_share_token())?;
    let base = ok(vault.try_asset())?;

    let is_share = *asset == Asset::Stellar(share_token.clone());
    if !is_share && *asset != Asset::Stellar(base.clone()) {
        return None;
    }

    if winding_down(&ok(vault.try_wind_down())?) {
        return None;
    }

    let oracle = OracleFeedClient::new(e, &ok(vault.try_oracle())?);
    if ok(oracle.try_state())? != OracleState::Valid {
        return None;
    }
    let timestamp = ok(oracle.try_attested_at())?;

    let price = if is_share {
        let nav_per_share = ok(oracle.try_nav_per_share())?;
        let asset_decimals = ok(TokenClient::new(e, &base).try_decimals())?;
        let share_decimals = ok(TokenClient::new(e, &share_token).try_decimals())?;
        share_price(nav_per_share, asset_decimals, share_decimals)?
    } else {
        ONE
    };

    Some((PriceData { price, timestamp }, oracle))
}

/// The most recent price of `asset`, if any.
pub(crate) fn latest(e: &Env, asset: &Asset) -> Option<PriceData> {
    quote(e, asset).map(|(data, _)| data)
}

/// The latest report's price if its window covers `timestamp`, which must
/// not be later than the ledger time.
pub(crate) fn at(e: &Env, asset: &Asset, timestamp: u64) -> Option<PriceData> {
    if timestamp > e.ledger().timestamp() {
        return None;
    }

    let (data, oracle) = quote(e, asset)?;
    let freshness = ok(oracle.try_freshness_duration())?;
    let expires_at = data.timestamp.checked_add(freshness)?;

    (data.timestamp <= timestamp && timestamp < expires_at).then_some(data)
}

/// The current oracle's freshness window, in seconds.
pub(crate) fn resolution(e: &Env) -> u32 {
    let oracle_address = match ok(VaultViewClient::new(e, &bound_vault(e)).try_oracle()) {
        Some(address) => address,
        None => return 0,
    };
    match ok(OracleFeedClient::new(e, &oracle_address).try_freshness_duration()) {
        Some(freshness) => u32::try_from(freshness).unwrap_or(u32::MAX),
        None => 0,
    }
}
