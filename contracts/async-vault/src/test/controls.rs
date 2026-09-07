use super::*;

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
fn a_paused_vault_still_lets_investors_claim() {
    let f = setup();
    let user = f.investor(1_000);

    f.vault.request_deposit(&user, &400);
    f.fulfill_epoch(wad(2));
    f.vault.pause(&f.admin);

    assert_eq!(f.vault.claim_deposit(&user, &1), 200);
    assert_eq!(f.shares(&user), 200);
}

#[test]
fn a_paused_vault_still_takes_redeem_requests() {
    let f = setup();
    let user = f.holder(500);
    let epoch = f.vault.current_epoch();

    f.vault.pause(&f.admin);

    assert_eq!(f.vault.request_redeem(&user, &200), epoch);
    assert_eq!(f.shares(&f.vault.address), 200);
}

#[test]
fn a_paused_vault_still_pays_redemptions() {
    let f = setup();
    let user = f.holder(500);
    let epoch = f.vault.request_redeem(&user, &200);
    f.fulfill_epoch(wad(2));
    f.vault.pause(&f.admin);

    assert_eq!(f.vault.claim_redeem(&user, &epoch), 400);
}
