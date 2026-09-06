extern crate std;

use soroban_sdk::{testutils::Address as _, Address, Env};

use crate::{AsyncVault, AsyncVaultClient, EpochStatus};

fn setup(e: &Env) -> (AsyncVaultClient<'_>, Address, Address) {
    let asset = Address::generate(e);
    let manager = Address::generate(e);
    let contract_id = e.register(AsyncVault, (&asset, &manager));

    (AsyncVaultClient::new(e, &contract_id), asset, manager)
}

#[test]
fn test_successful_deployment() {
    let e = Env::default();
    let (vault, asset, manager) = setup(&e);

    assert_eq!(vault.asset(), asset);
    assert_eq!(vault.manager(), manager);

    let first = vault.get_epoch(&1).unwrap();
    assert_eq!(first.status, EpochStatus::Open);
    assert_eq!(first.total_deposited, 0);
    assert_eq!(first.share_price, 0);
}

#[test]
fn epoch_zero_is_the_absent_id() {
    let e = Env::default();
    let (vault, _, _) = setup(&e);

    assert_eq!(vault.get_epoch(&0), None);
}

#[test]
fn unwritten_epoch_reads_as_none() {
    let e = Env::default();
    let (vault, _, _) = setup(&e);

    assert_eq!(vault.get_epoch(&2), None);
}
