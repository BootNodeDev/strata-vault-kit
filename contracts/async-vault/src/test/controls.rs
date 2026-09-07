use super::*;

#[test]
fn a_paused_vault_takes_no_deposits() {
    let f = setup();
    let investor = f.investor(1_000);

    f.vault.pause(&f.guardian);
    assert!(f.vault.paused());
    assert!(f.vault.try_request_deposit(&investor, &100).is_err());

    f.vault.unpause(&f.admin);
    f.vault.request_deposit(&investor, &100);
    assert_eq!(f.vault.get_epoch(&1).unwrap().total_deposited, 100);
}

#[test]
fn only_the_guardian_pauses() {
    let f = setup();
    let stranger = Address::generate(&f.e);

    assert!(f.vault.try_pause(&stranger).is_err());
    assert!(f.vault.try_pause(&f.admin).is_err());
    assert!(f.vault.try_pause(&f.manager).is_err());
    assert!(f.vault.try_pause(&f.treasury).is_err());
    assert!(!f.vault.paused());

    f.vault.pause(&f.guardian);
    assert!(f.vault.paused());
}

#[test]
fn the_guardian_pauses_but_only_governance_unpauses() {
    let f = setup();
    f.vault.pause(&f.guardian);

    f.e.set_auths(&[]);
    assert!(f.vault.try_unpause(&f.guardian).is_err());
    assert!(f.vault.try_unpause(&f.admin).is_err());
    assert!(f.vault.paused());

    f.e.mock_all_auths();
    f.vault.unpause(&f.admin);
    assert!(!f.vault.paused());
}

#[test]
fn a_paused_vault_still_lets_investors_claim() {
    let f = setup();
    let user = f.investor(1_000);

    f.vault.request_deposit(&user, &400);
    f.fulfill_epoch(wad(2));
    f.vault.pause(&f.guardian);

    assert_eq!(f.vault.claim_deposit(&user, &1), 200);
    assert_eq!(f.shares(&user), 200);
}

#[test]
fn a_paused_vault_still_takes_redeem_requests() {
    let f = setup();
    let user = f.holder(500);
    let epoch = f.vault.current_epoch();

    f.vault.pause(&f.guardian);

    assert_eq!(f.vault.request_redeem(&user, &200), epoch);
    assert_eq!(f.shares(&f.vault.address), 200);
}

#[test]
fn a_paused_vault_still_pays_redemptions() {
    let f = setup();
    let user = f.holder(500);
    let epoch = f.vault.request_redeem(&user, &200);
    f.fulfill_epoch(wad(2));
    f.vault.pause(&f.guardian);

    assert_eq!(f.vault.claim_redeem(&user, &epoch), 400);
}
