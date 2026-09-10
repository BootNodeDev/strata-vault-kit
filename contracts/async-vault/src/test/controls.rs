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

#[test]
fn a_paused_vault_does_not_fulfill_epochs() {
    let f = setup();
    f.close_epoch();
    f.attest(wad(2));
    f.vault.pause(&f.guardian);

    assert!(f.vault.try_fulfill_epoch(&1).is_err());

    f.vault.unpause(&f.admin);
    assert_eq!(f.vault.fulfill_epoch(&1), wad(2));
}

#[test]
fn every_authority_is_readable() {
    let f = setup();

    assert_eq!(f.vault.governance(), Some(f.admin.clone()));
    assert_eq!(f.vault.manager(), Some(f.manager.clone()));
    assert_eq!(f.vault.treasury(), Some(f.treasury.clone()));
    assert_eq!(f.vault.guardian(), Some(f.guardian.clone()));
}

#[test]
fn governance_can_replace_the_guardian() {
    let f = setup();
    let next = Address::generate(&f.e);

    f.vault
        .grant_role(&next, &symbol_short!("guardian"), &f.admin);
    f.vault
        .revoke_role(&f.guardian, &symbol_short!("guardian"), &f.admin);

    assert_eq!(f.vault.guardian(), Some(next.clone()));
    assert!(f.vault.try_pause(&f.guardian).is_err());
    f.vault.pause(&next);
    assert!(f.vault.paused());
}

#[test]
fn the_clock_helper_moves_time_and_sequence() {
    let f = setup();
    let (t0, s0) = (f.e.ledger().timestamp(), f.e.ledger().sequence());

    f.advance(3_600);

    assert_eq!(f.e.ledger().timestamp(), t0 + 3_600);
    assert!(f.e.ledger().sequence() > s0);
}

#[test]
fn a_cooldown_holds_the_standing_price() {
    let f = setup_with_feed(OracleConfig {
        cooldown_secs: 3_600,
        ..open_feed()
    });
    // holder() attests at 2.0 to price its own deposit.
    let holder = f.holder(100);

    f.vault.request_redeem(&holder, &100);
    let epoch = f.close_epoch();

    // Inside the cooldown a new attestation is refused, so the epoch prices at
    // the record already standing rather than one the attester cannot post.
    f.advance(60);
    assert!(f
        .oracle
        .try_attest(
            &NavReport {
                nav_per_share: wad(1),
                timestamp: 0,
                expires_at: 1_000_000,
            },
            &f.attester
        )
        .is_err());

    f.vault.fulfill_epoch(&epoch);
    assert_eq!(f.vault.get_epoch(&epoch).unwrap().share_price, wad(2));
}

#[test]
fn a_stale_feed_refuses_to_price_until_reattested() {
    let f = setup();
    let holder = f.holder(100);

    f.attest(wad(1));
    f.vault.request_redeem(&holder, &100);
    let epoch = f.close_epoch();

    f.advance(7_200); // past the 3600s freshness window
    assert!(f.vault.try_fulfill_epoch(&epoch).is_err());

    f.attest(wad(1));
    f.vault.fulfill_epoch(&epoch);
    assert_eq!(f.vault.get_epoch(&epoch).unwrap().share_price, wad(1));
}
