use super::*;

#[test]
fn governance_sets_the_delay_within_the_maximum() {
    let f = setup();

    assert_eq!(f.vault.wind_down_delay(), 0);

    f.vault.set_wind_down_delay(&(7 * 24 * 60 * 60), &f.admin);
    assert_eq!(f.vault.wind_down_delay(), 7 * 24 * 60 * 60);
}

#[test]
fn the_delay_cannot_exceed_the_maximum() {
    let f = setup();

    assert!(f
        .vault
        .try_set_wind_down_delay(&(MAX_WIND_DOWN_DELAY + 1), &f.admin)
        .is_err());
    assert_eq!(f.vault.wind_down_delay(), 0);
}

#[test]
fn only_governance_sets_the_delay() {
    let f = setup();
    let stranger = Address::generate(&f.e);

    f.e.set_auths(&[]);
    assert!(f.vault.try_set_wind_down_delay(&60, &stranger).is_err());
    assert!(f.vault.try_set_wind_down_delay(&60, &f.manager).is_err());
    assert!(f.vault.try_set_wind_down_delay(&60, &f.treasury).is_err());
    assert!(f.vault.try_set_wind_down_delay(&60, &f.guardian).is_err());
    assert_eq!(f.vault.wind_down_delay(), 0);
}

#[test]
fn a_fresh_vault_is_not_winding_down() {
    let f = setup();

    assert_eq!(f.vault.wind_down(), None);
}

const WEEK: u64 = 7 * 24 * 60 * 60;

#[test]
fn governance_proposes_and_anyone_activates_after_the_delay() {
    let f = setup();
    let stranger = Address::generate(&f.e);
    f.vault.set_wind_down_delay(&WEEK, &f.admin);

    f.vault.propose_wind_down(&f.admin);
    let proposed = f.vault.wind_down().unwrap();
    assert_eq!(proposed.status, WindDownStatus::Proposed);
    assert_eq!(proposed.round, 0);

    assert!(f.vault.try_activate_wind_down().is_err());

    f.advance(WEEK);
    f.vault.activate_wind_down();

    assert_eq!(f.vault.wind_down().unwrap().status, WindDownStatus::Active);
    let _ = stranger;
}

#[test]
fn activation_is_open_to_a_stranger() {
    let f = setup();
    f.vault.set_wind_down_delay(&WEEK, &f.admin);
    f.vault.propose_wind_down(&f.admin);
    f.advance(WEEK);

    f.e.set_auths(&[]);
    f.vault.activate_wind_down();

    assert_eq!(f.vault.wind_down().unwrap().status, WindDownStatus::Active);
}

#[test]
fn only_governance_proposes() {
    let f = setup();
    let stranger = Address::generate(&f.e);

    f.e.set_auths(&[]);
    assert!(f.vault.try_propose_wind_down(&stranger).is_err());
    assert!(f.vault.try_propose_wind_down(&f.manager).is_err());
    assert!(f.vault.try_propose_wind_down(&f.guardian).is_err());
    assert_eq!(f.vault.wind_down(), None);
}

#[test]
fn a_second_proposal_cannot_push_the_date_back() {
    let f = setup();
    f.vault.set_wind_down_delay(&WEEK, &f.admin);
    f.vault.propose_wind_down(&f.admin);
    let first = f.vault.wind_down().unwrap().active_at;

    f.advance(WEEK / 2);
    assert!(f.vault.try_propose_wind_down(&f.admin).is_err());

    assert_eq!(f.vault.wind_down().unwrap().active_at, first);
}

#[test]
fn governance_cancels_a_proposal_before_activation() {
    let f = setup();
    f.vault.set_wind_down_delay(&WEEK, &f.admin);
    f.vault.propose_wind_down(&f.admin);

    f.vault.cancel_wind_down_proposal(&f.admin);
    assert_eq!(f.vault.wind_down(), None);

    f.vault.propose_wind_down(&f.admin);
    assert_eq!(
        f.vault.wind_down().unwrap().status,
        WindDownStatus::Proposed
    );
}

#[test]
fn an_active_wind_down_cannot_be_cancelled() {
    let f = setup();
    f.vault.set_wind_down_delay(&WEEK, &f.admin);
    f.vault.propose_wind_down(&f.admin);
    f.advance(WEEK);
    f.vault.activate_wind_down();

    assert!(f.vault.try_cancel_wind_down_proposal(&f.admin).is_err());
    assert_eq!(f.vault.wind_down().unwrap().status, WindDownStatus::Active);
}

#[test]
fn activating_without_a_proposal_is_refused() {
    let f = setup();

    assert!(f.vault.try_activate_wind_down().is_err());
}

#[test]
fn a_zero_delay_activates_immediately() {
    let f = setup();

    f.vault.propose_wind_down(&f.admin);
    f.vault.activate_wind_down();

    assert_eq!(f.vault.wind_down().unwrap().status, WindDownStatus::Active);
}
