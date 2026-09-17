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
