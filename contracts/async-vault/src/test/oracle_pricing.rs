use super::*;

#[test]
fn fulfill_is_rejected_before_the_first_attestation() {
    let f = setup();
    f.close_epoch();

    assert!(f.vault.try_fulfill_epoch(&f.manager, &1).is_err());
    assert_eq!(f.vault.get_epoch(&1).unwrap().status, EpochStatus::Pending);
}

#[test]
fn fulfill_is_rejected_while_the_ripcord_is_raised() {
    let f = setup();
    f.close_epoch();
    f.attest(wad(2));
    f.oracle.set_ripcord(&true, &f.admin);

    assert!(f.vault.try_fulfill_epoch(&f.manager, &1).is_err());

    f.oracle.set_ripcord(&false, &f.admin);
    assert_eq!(f.vault.fulfill_epoch(&f.manager, &1), wad(2));
}

#[test]
fn fulfill_is_rejected_once_the_feed_goes_stale() {
    let f = setup();
    f.close_epoch();
    f.attest(wad(2));

    f.e.ledger().set_timestamp(10_000 + 3_601);
    assert!(f.oracle.is_stale());
    assert!(f.vault.try_fulfill_epoch(&f.manager, &1).is_err());
    assert_eq!(f.vault.get_epoch(&1).unwrap().status, EpochStatus::Pending);
}

#[test]
fn the_epoch_is_struck_at_the_attested_price() {
    let f = setup();
    f.close_epoch();
    f.attest(3 * WAD_SCALE / 2);

    f.vault.fulfill_epoch(&f.manager, &1);

    assert_eq!(
        f.vault.get_epoch(&1).unwrap().share_price,
        3 * WAD_SCALE / 2
    );
    assert_eq!(f.oracle.nav_per_share(), 3 * WAD_SCALE / 2);
}
