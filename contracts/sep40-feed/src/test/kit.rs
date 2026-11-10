//! Proves the feed against the kit's real vault and oracle, not stubs.

use soroban_sdk::{
    testutils::{Address as _, Ledger as _},
    Address, BytesN, Env, String,
};

use async_vault::{AsyncVault, VaultRoles};
use nav_oracle::{NavInput, NavOracleContract, NavOracleContractClient, OracleConfig, MIN_ANSWER};

use sep40::{Asset, PriceData};

use super::PRICE;
use crate::{Sep40Feed, Sep40FeedClient};

const WAD: i128 = 1_000_000_000_000_000_000;

fn reads_the_vault_view<T: strata_bindings::VaultView>() {}
fn reads_the_oracle_feed<T: strata_bindings::OracleFeed>() {}

#[test]
fn the_feed_quotes_a_kit_vault_through_its_oracle() {
    reads_the_vault_view::<AsyncVault>();
    reads_the_oracle_feed::<NavOracleContract>();

    let e = Env::default();
    e.mock_all_auths();
    e.ledger().set_timestamp(10_000);

    let asset = e
        .register_stellar_asset_contract_v2(Address::generate(&e))
        .address();
    let share = e
        .register_stellar_asset_contract_v2(Address::generate(&e))
        .address();

    let admin = Address::generate(&e);
    let attester = Address::generate(&e);
    let guardian = Address::generate(&e);
    let oracle = NavOracleContractClient::new(
        &e,
        &e.register(
            NavOracleContract,
            (
                admin,
                attester.clone(),
                guardian,
                OracleConfig {
                    freshness_duration: 3_600,
                    cooldown_secs: 1,
                    max_up_bps: 10_000,
                    max_down_bps: 10_000,
                    min_answer: MIN_ANSWER,
                    max_answer: 1_000 * WAD,
                },
            ),
        ),
    );

    let roles = VaultRoles {
        governance: Address::generate(&e),
        manager: Address::generate(&e),
        treasury: Address::generate(&e),
        guardian: Address::generate(&e),
        compliance: Address::generate(&e),
        attester: Address::generate(&e),
    };
    let vault = e.register(
        AsyncVault,
        (asset.clone(), share.clone(), oracle.address.clone(), roles),
    );

    let feed = Sep40FeedClient::new(&e, &e.register(Sep40Feed, (vault,)));
    let share_asset = Asset::Stellar(share);

    assert_eq!(feed.lastprice(&share_asset), None);

    oracle.attest(
        &NavInput {
            nav_per_share: 105 * WAD / 100,
            expires_at: u64::MAX,
            proof_hash: BytesN::from_array(&e, &[7; 32]),
            proof_uri: String::from_str(&e, ""),
        },
        &attester,
    );

    assert_eq!(
        feed.lastprice(&share_asset),
        Some(PriceData {
            price: PRICE,
            timestamp: 10_000,
        })
    );
    assert_eq!(feed.resolution(), 3_600);
    assert_eq!(feed.base(), Asset::Stellar(asset));
}
