use super::*;

#[test]
fn capital_makes_the_round_trip_to_the_custodian() {
    let f = setup();
    let investor = f.investor(1_000);
    f.vault.request_deposit(&investor, &1_000);
    f.vault.set_custodian(&f.custodian, &f.admin);

    assert_eq!(f.vault.free_reserve(), 1_000);
    assert_eq!(f.vault.deploy_to_custodian(&f.treasury, &600), 600);

    assert_eq!(f.balance(&f.custodian), 600);
    assert_eq!(f.balance(&f.vault.address), 400);
    assert_eq!(f.vault.net_deployed(), 600);
    assert_eq!(f.vault.free_reserve(), 400);

    assert_eq!(f.vault.fund(&f.custodian, &600), 0);

    assert_eq!(f.balance(&f.vault.address), 1_000);
    assert_eq!(f.vault.net_deployed(), 0);
}

#[test]
fn returning_more_than_was_deployed_shows_as_negative_net() {
    let f = setup();
    let investor = f.investor(1_000);
    f.vault.request_deposit(&investor, &1_000);
    f.vault.set_custodian(&f.custodian, &f.admin);

    f.vault.deploy_to_custodian(&f.treasury, &600);
    StellarAssetClient::new(&f.e, &f.asset).mint(&f.custodian, &50);

    assert_eq!(f.vault.fund(&f.custodian, &650), -50);
    assert_eq!(f.balance(&f.vault.address), 1_050);
}

#[test]
fn assets_owed_to_a_priced_redemption_cannot_be_deployed() {
    let f = setup();
    let holder = f.holder(500);
    let epoch = f.vault.request_redeem(&holder, &500);
    f.vault.set_custodian(&f.custodian, &f.admin);

    assert_eq!(f.fulfill_epoch(wad(2)), epoch);

    assert_eq!(f.balance(&f.vault.address), 1_000);
    assert_eq!(f.vault.free_reserve(), 0);
    assert!(f.vault.try_deploy_to_custodian(&f.treasury, &1).is_err());

    assert_eq!(f.vault.claim_redeem(&holder, &epoch), 1_000);
}

#[test]
fn an_unpriced_redemption_does_not_reserve_anything_yet() {
    let f = setup();
    let holder = f.holder(500);
    f.vault.request_redeem(&holder, &500);
    f.vault.set_custodian(&f.custodian, &f.admin);

    assert_eq!(f.vault.free_reserve(), 1_000);
    assert_eq!(f.vault.deploy_to_custodian(&f.treasury, &1_000), 1_000);
}

#[test]
fn an_epoch_cannot_be_fulfilled_while_the_capital_is_deployed() {
    let f = setup();
    let holder = f.holder(500);
    let epoch = f.vault.request_redeem(&holder, &500);
    f.vault.set_custodian(&f.custodian, &f.admin);
    f.vault.deploy_to_custodian(&f.treasury, &1_000);

    f.close_epoch();
    f.attest(wad(2));
    assert!(f.vault.try_fulfill_epoch(&epoch).is_err());

    f.vault.fund(&f.custodian, &1_000);
    assert_eq!(f.vault.fulfill_epoch(&epoch), wad(2));
    assert_eq!(f.vault.claim_redeem(&holder, &epoch), 1_000);
}

#[test]
fn deploying_needs_the_treasury_role() {
    let f = setup();
    let investor = f.investor(1_000);
    f.vault.request_deposit(&investor, &1_000);
    f.vault.set_custodian(&f.custodian, &f.admin);

    assert!(f.vault.try_deploy_to_custodian(&f.manager, &100).is_err());
    assert!(f.vault.try_deploy_to_custodian(&f.admin, &100).is_err());
    assert_eq!(f.balance(&f.custodian), 0);
}

#[test]
fn deploying_without_a_custodian_is_rejected() {
    let f = setup();
    let investor = f.investor(1_000);
    f.vault.request_deposit(&investor, &1_000);

    assert_eq!(f.vault.custodian(), None);
    assert!(f.vault.try_deploy_to_custodian(&f.treasury, &100).is_err());
}

#[test]
fn setting_the_custodian_needs_the_admin_signature() {
    let f = setup();

    f.e.set_auths(&[]);
    assert!(f.vault.try_set_custodian(&f.custodian, &f.admin).is_err());
    assert!(f
        .vault
        .try_set_custodian(&f.custodian, &f.treasury)
        .is_err());
    assert_eq!(f.vault.custodian(), None);
}

#[test]
fn deploying_a_non_positive_amount_is_rejected() {
    let f = setup();
    let investor = f.investor(1_000);
    f.vault.request_deposit(&investor, &1_000);
    f.vault.set_custodian(&f.custodian, &f.admin);

    assert!(f.vault.try_deploy_to_custodian(&f.treasury, &0).is_err());
    assert!(f.vault.try_deploy_to_custodian(&f.treasury, &-1).is_err());
}
