extern crate std;

use soroban_sdk::{
    testutils::{Address as _, MockAuth, MockAuthInvoke},
    token::{StellarAssetClient, TokenClient},
    Address, Env, IntoVal,
};

use crate::{AsyncVault, AsyncVaultClient, EpochStatus};

struct Fixture<'a> {
    e: Env,
    vault: AsyncVaultClient<'a>,
    asset: Address,
    manager: Address,
    admin: Address,
}

impl Fixture<'_> {
    fn investor(&self, funded: i128) -> Address {
        let who = Address::generate(&self.e);
        StellarAssetClient::new(&self.e, &self.asset).mint(&who, &funded);
        who
    }

    fn balance(&self, who: &Address) -> i128 {
        TokenClient::new(&self.e, &self.asset).balance(who)
    }
}

fn setup<'a>() -> Fixture<'a> {
    let e = Env::default();
    e.mock_all_auths();

    let issuer = Address::generate(&e);
    let asset = e.register_stellar_asset_contract_v2(issuer).address();
    let manager = Address::generate(&e);
    let admin = Address::generate(&e);

    let contract_id = e.register(AsyncVault, (&asset, &manager, &admin));

    Fixture {
        vault: AsyncVaultClient::new(&e, &contract_id),
        asset,
        manager,
        admin,
        e,
    }
}

#[test]
fn test_successful_deployment() {
    let f = setup();

    assert_eq!(f.vault.asset(), f.asset);
    assert_eq!(f.vault.manager(), f.manager);
    assert!(!f.vault.paused());

    let first = f.vault.get_epoch(&1).unwrap();
    assert_eq!(first.status, EpochStatus::Open);
    assert_eq!(first.total_deposited, 0);
    assert_eq!(first.share_price, 0);
}

#[test]
fn epoch_zero_is_the_absent_id() {
    let f = setup();
    assert_eq!(f.vault.get_epoch(&0), None);
}

#[test]
fn unwritten_epoch_reads_as_none() {
    let f = setup();
    assert_eq!(f.vault.get_epoch(&2), None);
}

#[test]
fn test_request_deposit_updates_epoch_and_user_state() {
    let f = setup();
    let user = f.investor(1_000);

    assert_eq!(f.vault.request_deposit(&user, &400), 1);

    assert_eq!(f.balance(&user), 600);
    assert_eq!(f.balance(&f.vault.address), 400);

    let epoch_info = f.vault.get_epoch(&1).unwrap();
    assert_eq!(epoch_info.total_deposited, 400);
    assert_eq!(epoch_info.status, EpochStatus::Open);

    let user_req = f.vault.get_deposit_request(&1, &user).unwrap();
    assert_eq!(user_req.amount, 400);
    assert!(!user_req.claimed);
}

#[test]
fn deposits_from_several_investors_accumulate_in_the_epoch() {
    let f = setup();
    let one = f.investor(1_000);
    let two = f.investor(1_000);

    f.vault.request_deposit(&one, &400);
    f.vault.request_deposit(&two, &250);

    assert_eq!(f.vault.get_epoch(&1).unwrap().total_deposited, 650);
    assert_eq!(f.balance(&f.vault.address), 650);
    assert_eq!(f.vault.get_deposit_request(&1, &one).unwrap().amount, 400);
    assert_eq!(f.vault.get_deposit_request(&1, &two).unwrap().amount, 250);
}

#[test]
fn a_second_request_from_the_same_investor_is_rejected() {
    let f = setup();
    let investor = f.investor(1_000);

    f.vault.request_deposit(&investor, &400);
    assert!(f.vault.try_request_deposit(&investor, &100).is_err());

    assert_eq!(f.vault.get_epoch(&1).unwrap().total_deposited, 400);
    assert_eq!(f.balance(&investor), 600);
}

#[test]
fn request_deposit_rejects_a_non_positive_amount() {
    let f = setup();
    let investor = f.investor(1_000);

    assert!(f.vault.try_request_deposit(&investor, &0).is_err());
    assert!(f.vault.try_request_deposit(&investor, &-1).is_err());
    assert_eq!(f.balance(&investor), 1_000);
}

#[test]
fn request_deposit_rejects_a_total_that_would_overflow() {
    let f = setup();
    let whale = f.investor(i128::MAX);
    let other = f.investor(1_000);

    f.vault.request_deposit(&whale, &(i128::MAX - 10));
    assert!(f.vault.try_request_deposit(&other, &11).is_err());

    assert_eq!(
        f.vault.get_epoch(&1).unwrap().total_deposited,
        i128::MAX - 10
    );
}

#[test]
fn request_deposit_needs_the_investor_authorisation() {
    let e = Env::default();

    let issuer = Address::generate(&e);
    let asset = e
        .register_stellar_asset_contract_v2(issuer.clone())
        .address();
    let contract_id = e.register(
        AsyncVault,
        (&asset, &Address::generate(&e), &Address::generate(&e)),
    );

    e.mock_all_auths();
    let investor = Address::generate(&e);
    StellarAssetClient::new(&e, &asset).mint(&investor, &1_000);

    let vault = AsyncVaultClient::new(&e, &contract_id);
    e.set_auths(&[]);
    assert!(vault.try_request_deposit(&investor, &100).is_err());
}

#[test]
fn a_paused_vault_takes_no_deposits() {
    let f = setup();
    let investor = f.investor(1_000);

    f.vault.pause(&f.admin);
    assert!(f.vault.paused());
    assert!(f.vault.try_request_deposit(&investor, &100).is_err());

    f.vault.unpause(&f.admin);
    f.vault.request_deposit(&investor, &100);
    assert_eq!(f.vault.get_epoch(&1).unwrap().total_deposited, 100);
}

#[test]
fn only_the_admin_pauses() {
    let f = setup();
    let stranger = Address::generate(&f.e);

    f.e.mock_auths(&[MockAuth {
        address: &stranger,
        invoke: &MockAuthInvoke {
            contract: &f.vault.address,
            fn_name: "pause",
            args: (stranger.clone(),).into_val(&f.e),
            sub_invokes: &[],
        },
    }]);

    assert!(f.vault.try_pause(&stranger).is_err());
    assert!(!f.vault.paused());
}

#[test]
fn an_investor_without_a_request_reads_as_none() {
    let f = setup();
    let investor = f.investor(1_000);

    assert_eq!(f.vault.get_deposit_request(&1, &investor), None);
}

#[test]
fn test_manager_can_fulfill_epoch_and_rotate() {
    let f = setup();

    assert_eq!(f.vault.fulfill_epoch(&f.manager, &2), 2);

    let epoch_1 = f.vault.get_epoch(&1).unwrap();
    assert_eq!(epoch_1.status, EpochStatus::Fulfilled);
    assert_eq!(epoch_1.share_price, 2);

    let epoch_2 = f.vault.get_epoch(&2).unwrap();
    assert_eq!(epoch_2.status, EpochStatus::Open);
    assert_eq!(epoch_2.total_deposited, 0);
    assert_eq!(epoch_2.share_price, 0);

    assert_eq!(f.vault.current_epoch(), 2);
}

#[test]
#[should_panic(expected = "#2000")]
fn test_non_manager_cannot_fulfill() {
    let f = setup();
    let impostor = Address::generate(&f.e);

    f.vault.fulfill_epoch(&impostor, &2);
}

#[test]
fn the_admin_is_not_the_manager() {
    let f = setup();
    assert!(f.vault.try_fulfill_epoch(&f.admin, &2).is_err());
    assert_eq!(f.vault.current_epoch(), 1);
}

#[test]
fn fulfilling_keeps_the_struck_epoch_total() {
    let f = setup();
    let investor = f.investor(1_000);

    f.vault.request_deposit(&investor, &400);
    f.vault.fulfill_epoch(&f.manager, &2);

    let epoch_1 = f.vault.get_epoch(&1).unwrap();
    assert_eq!(epoch_1.total_deposited, 400);
    assert_eq!(epoch_1.share_price, 2);
    assert_eq!(
        f.vault.get_deposit_request(&1, &investor).unwrap().amount,
        400
    );
}

#[test]
fn deposits_after_fulfilling_land_in_the_new_epoch() {
    let f = setup();
    let investor = f.investor(1_000);

    f.vault.request_deposit(&investor, &400);
    f.vault.fulfill_epoch(&f.manager, &2);

    assert_eq!(f.vault.request_deposit(&investor, &300), 2);

    assert_eq!(f.vault.get_epoch(&1).unwrap().total_deposited, 400);
    assert_eq!(f.vault.get_epoch(&2).unwrap().total_deposited, 300);
    assert_eq!(
        f.vault.get_deposit_request(&2, &investor).unwrap().amount,
        300
    );
    assert_eq!(f.balance(&f.vault.address), 700);
}

#[test]
fn fulfill_rejects_a_non_positive_share_price() {
    let f = setup();

    assert!(f.vault.try_fulfill_epoch(&f.manager, &0).is_err());
    assert!(f.vault.try_fulfill_epoch(&f.manager, &-1).is_err());
    assert_eq!(f.vault.get_epoch(&1).unwrap().status, EpochStatus::Open);
    assert_eq!(f.vault.current_epoch(), 1);
}

#[test]
fn fulfilling_needs_the_manager_authorisation() {
    let f = setup();

    f.e.set_auths(&[]);
    assert!(f.vault.try_fulfill_epoch(&f.manager, &2).is_err());
    assert_eq!(f.vault.current_epoch(), 1);
}
