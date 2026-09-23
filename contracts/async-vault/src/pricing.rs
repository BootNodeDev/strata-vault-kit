use bindings::OracleFeedClient;
use soroban_sdk::Env;
use stellar_contract_utils::math::{i128_fixed_point::checked_mul_div_floor, wad::WAD_SCALE};

use crate::error::VaultError;
use crate::keys::DataKey;
use crate::state;
use crate::treasury;

/// Defines the pricing interface for epoch share price resolution and conversions.
/// A deployment or vault variant selects or implements a scheme conforming to this trait.
pub trait PricingScheme {
    /// Resolves the share price for an epoch being fulfilled.
    /// Returns the share price in WAD scale (18 decimals), or a VaultError if invalid.
    fn resolve_share_price(e: &Env) -> Result<i128, VaultError>;

    /// Converts asset amount to share amount at `share_price`, rounding down
    /// in the vault's favour (minting fewer shares).
    fn deposit_shares(e: &Env, assets: i128, share_price: i128) -> Result<i128, VaultError> {
        if share_price <= 0 {
            return Err(VaultError::InvalidSharePrice);
        }
        checked_mul_div_floor(e, &assets, &WAD_SCALE, &share_price)
            .ok_or(VaultError::AmountTooLarge)
    }

    /// Converts share amount to asset amount at `share_price`, rounding down
    /// in the vault's favour (paying out fewer assets).
    fn redeem_assets(e: &Env, shares: i128, share_price: i128) -> Result<i128, VaultError> {
        if share_price <= 0 {
            return Err(VaultError::InvalidSharePrice);
        }
        checked_mul_div_floor(e, &shares, &share_price, &WAD_SCALE)
            .ok_or(VaultError::AmountTooLarge)
    }
}

/// The standard default pricing scheme: receives a direct unit share price from
/// off-chain fund accounting attested via the oracle feed.
pub struct DirectUnitPricing;

impl PricingScheme for DirectUnitPricing {
    fn resolve_share_price(e: &Env) -> Result<i128, VaultError> {
        let feed = OracleFeedClient::new(e, &state::get_addr(e, &DataKey::Oracle));
        let share_price = feed.nav_per_share();
        if share_price <= 0 {
            return Err(VaultError::InvalidSharePrice);
        }
        Ok(share_price)
    }
}

/// Derived net-asset pricing scheme: derives the unit share price from attested
/// off-chain deployed assets plus liquid reserve minus liabilities, divided by
/// total economic supply:
///
///   NAV = (attested_assets + balance - liabilities) * WAD_SCALE / supply
pub struct DerivedNetAssetPricing;

impl DerivedNetAssetPricing {
    /// Pure calculation of derived share price given components.
    pub fn calculate_share_price(
        e: &Env,
        attested_assets: i128,
        balance: i128,
        liabilities: i128,
        supply: i128,
    ) -> Result<i128, VaultError> {
        if supply <= 0 {
            return Ok(WAD_SCALE);
        }
        let total_assets = attested_assets
            .checked_add(balance)
            .ok_or(VaultError::AmountTooLarge)?;
        let net_assets = total_assets
            .checked_sub(liabilities)
            .ok_or(VaultError::AmountTooLarge)?;
        if net_assets <= 0 {
            return Err(VaultError::InvalidSharePrice);
        }
        let price = checked_mul_div_floor(e, &net_assets, &WAD_SCALE, &supply)
            .ok_or(VaultError::AmountTooLarge)?;
        if price <= 0 {
            return Err(VaultError::InvalidSharePrice);
        }
        Ok(price)
    }
}

impl PricingScheme for DerivedNetAssetPricing {
    fn resolve_share_price(e: &Env) -> Result<i128, VaultError> {
        let feed = OracleFeedClient::new(e, &state::get_addr(e, &DataKey::Oracle));
        let attested_assets = feed.nav_per_share();
        let balance = treasury::liquid_reserve(e);
        let liabilities = state::committed(e);
        let supply = crate::AsyncVault::total_economic_supply(e);
        Self::calculate_share_price(e, attested_assets, balance, liabilities, supply)
    }
}
