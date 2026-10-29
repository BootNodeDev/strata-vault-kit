use stellar_contract_utils::pausable::PausableError;

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
fn a_caller_other_than_the_admin_cannot_unpause_even_when_it_signs() {
    let f = setup();
    f.vault.pause(&f.guardian);

    for who in [f.guardian.clone(), Address::generate(&f.e)] {
        refused(f.vault.try_unpause(&who), VaultError::AdminRequired);
    }
    assert!(f.vault.paused());
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
fn the_token_admin_pauses_transfers_at_once_after_setup() {
    let f = setup();
    let holder = f.holder(500);
    let other = f.investor(0);
    let spender = Address::generate(&f.e);
    f.share
        .approve(&holder, &spender, &10, &(f.e.ledger().sequence() + 1_000));
    assert!(!f.share.setup_open());

    f.share.pause(&f.admin);
    assert!(f.share.paused());
    assert!(f.share.pending_changes().is_empty());
    assert_eq!(
        f.share.try_transfer(&holder, &other, &1),
        Err(Ok(PausableError::EnforcedPause.into()))
    );
    assert_eq!(
        f.share.try_transfer_from(&spender, &holder, &other, &1),
        Err(Ok(PausableError::EnforcedPause.into()))
    );

    f.share.unpause(&f.admin);
    f.share.transfer(&holder, &other, &1);
    f.share.transfer_from(&spender, &holder, &other, &1);
    assert_eq!(f.shares(&other), 2);
}

#[test]
fn a_token_pause_leaves_deposits_exits_and_cancellations_open() {
    let f = setup();
    let redeemer = f.holder(500);
    let leaver = f.holder(500);
    let depositor = f.investor(1_000);
    let quitter = f.investor(1_000);
    f.share.pause(&f.admin);

    let epoch = f.vault.request_deposit(&depositor, &400);
    assert_eq!(f.vault.request_redeem(&redeemer, &200), epoch);
    assert_eq!(f.vault.request_redeem(&leaver, &100), epoch);
    assert_eq!(f.shares(&f.vault.address), 300);

    f.vault.request_deposit(&quitter, &300);
    assert_eq!(f.vault.cancel_deposit(&quitter, &epoch), 300);
    assert_eq!(f.vault.cancel_redeem(&leaver, &epoch), 100);
    assert_eq!(f.shares(&leaver), 500);

    f.fulfill_epoch(wad(2));
    assert_eq!(f.vault.claim_deposit(&depositor, &epoch), 200);
    assert_eq!(f.shares(&depositor), 200);
    assert_eq!(f.vault.claim_redeem(&redeemer, &epoch), 400);
    assert_eq!(f.balance(&redeemer), 400);
    assert!(f.share.paused());
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

    let grant = f.vault.propose_change(&VaultChange::GrantRole(
        symbol_short!("guardian"),
        next.clone(),
    ));
    let revoke = f.vault.propose_change(&VaultChange::RevokeRole(
        symbol_short!("guardian"),
        f.guardian.clone(),
    ));
    f.advance(MIN_UPGRADE_DELAY);
    f.vault.apply_change(&grant);
    f.vault.apply_change(&revoke);

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
        .try_attest(&nav_input(&f.e, wad(1), 1_000_000), &f.attester)
        .is_err());

    f.vault.fulfill_epoch(&epoch);
    assert_eq!(f.vault.get_epoch(&epoch).unwrap().share_price, wad(2));
}

#[test]
fn a_cooldown_delays_pricing_until_the_attester_can_post() {
    let f = setup_with_feed(OracleConfig {
        cooldown_secs: 3_600,
        ..open_feed()
    });
    // holder() attests at 2.0 to price its own deposit.
    let holder = f.holder(100);

    f.vault.request_redeem(&holder, &100);
    f.advance(60);
    let epoch = f.close_epoch();

    // Inside the cooldown the attester cannot post, so the epoch has no
    // valuation younger than its close and waits.
    assert!(f
        .oracle
        .try_attest(&nav_input(&f.e, wad(1), 1_000_000), &f.attester)
        .is_err());
    refused(
        f.vault.try_fulfill_epoch(&epoch),
        VaultError::AttestationBeforeClose,
    );

    // Once the cooldown lapses the attester posts and the epoch prices at the
    // new number, not the one standing when it closed.
    f.advance(3_600);
    f.attest(wad(1));
    f.vault.fulfill_epoch(&epoch);

    assert_eq!(f.vault.get_epoch(&epoch).unwrap().share_price, wad(1));
}

#[test]
fn a_stale_feed_refuses_to_price_until_reattested() {
    let f = setup();
    let holder = f.holder(100);

    f.attest(wad(1));
    f.vault.request_redeem(&holder, &100);
    let epoch = f.close_epoch();

    f.advance(7_200); // past the 3600s freshness window
    refused(f.vault.try_fulfill_epoch(&epoch), VaultError::FeedNotValid);

    f.attest(wad(1));
    f.vault.fulfill_epoch(&epoch);
    assert_eq!(f.vault.get_epoch(&epoch).unwrap().share_price, wad(1));
}

#[test]
fn governance_cannot_renounce_itself_out_of_the_vault() {
    let f = setup();

    refused(f.vault.try_renounce_admin(), VaultError::AdminRequired);

    // Still governed: the admin-only paths keep working.
    f.vault.pause(&f.guardian);
    f.vault.unpause(&f.admin);
    assert_eq!(f.vault.governance(), Some(f.admin.clone()));
}

#[test]
fn governance_hands_over_in_two_steps_instead() {
    let f = setup();
    let next = Address::generate(&f.e);

    let id = f.vault.propose_change(&VaultChange::Admin(next.clone()));
    f.advance(MIN_UPGRADE_DELAY);
    f.vault.apply_change(&id);
    f.vault.accept_admin_transfer();

    assert_eq!(f.vault.governance(), Some(next.clone()));
    f.vault.pause(&f.guardian);
    f.vault.unpause(&next);
}
