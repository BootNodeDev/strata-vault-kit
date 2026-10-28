use super::*;

#[test]
fn the_first_epoch_starts_when_setup_finishes() {
    let f = setup_unfinished();
    assert_eq!(f.vault.epoch_opened_at(), None);

    f.advance(DAY_DURATION);
    f.vault.finish_setup();

    assert_eq!(f.vault.epoch_opened_at(), Some(f.e.ledger().timestamp()));
}

#[test]
fn a_seal_starts_the_next_epoch() {
    let f = setup();
    f.advance(3_600);
    let sealed_at = f.e.ledger().timestamp();

    let sealed = f.close_epoch();

    assert_eq!(f.vault.get_epoch(&sealed).unwrap().closed_at, sealed_at);
    assert_eq!(f.vault.epoch_opened_at(), Some(sealed_at));
}
