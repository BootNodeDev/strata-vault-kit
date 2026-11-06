use soroban_sdk::{testutils::storage::Instance as _, Symbol};

use sep40::Asset;

use super::stubs::{TokenStub, VaultStubClient};
use super::{setup, setup_with};
use crate::Sep40Feed;

#[test]
fn the_feed_follows_the_vault_it_was_built_for() {
    let f = setup();
    let binding = strata_bindings::VaultBindingClient::new(&f.e, &f.feed.address);
    assert_eq!(binding.vault(), Some(f.vault.address.clone()));
    assert!(!binding.setup_open());
}

#[test]
fn the_feed_stores_no_admin() {
    let f = setup();
    let keys =
        f.e.as_contract(&f.feed.address, || f.e.storage().instance().all());
    assert_eq!(keys.len(), 2);
}

#[test]
fn the_feed_quotes_the_share_in_the_vault_asset_at_fourteen_decimals() {
    let f = setup();
    assert_eq!(f.feed.decimals(), 14);
    assert_eq!(f.feed.base(), Asset::Stellar(f.asset.clone()));
    assert_eq!(
        f.feed.assets(),
        soroban_sdk::vec![&f.e, Asset::Stellar(f.share.clone())]
    );
}

#[test]
#[should_panic(expected = "#9001")]
fn an_address_that_is_not_a_vault_is_refused() {
    setup_with(|e, _| e.register(Sep40Feed, (e.register(TokenStub, (7u32,)),)));
}

#[test]
#[should_panic(expected = "#9001")]
fn a_vault_whose_governance_view_fails_is_refused() {
    setup_with(|e, (vault,)| {
        VaultStubClient::new(e, &vault).trap(&Symbol::new(e, "governance"));
        e.register(Sep40Feed, (vault,))
    });
}

#[test]
#[should_panic(expected = "#9001")]
fn a_vault_without_a_clock_is_refused() {
    setup_with(|e, (vault,)| {
        VaultStubClient::new(e, &vault).trap(&Symbol::new(e, "timelock_clock"));
        e.register(Sep40Feed, (vault,))
    });
}

#[test]
#[should_panic(expected = "#9001")]
fn a_vault_whose_wind_down_view_fails_is_refused() {
    setup_with(|e, (vault,)| {
        VaultStubClient::new(e, &vault).trap(&Symbol::new(e, "wind_down"));
        e.register(Sep40Feed, (vault,))
    });
}
