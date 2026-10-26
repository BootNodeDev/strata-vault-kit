use super::*;
use crate::pause;

#[test]
fn pause_time_accumulates_across_pauses() {
    let (e, id) = owner();
    e.as_contract(&id, || {
        pause::start(&e);
        e.ledger().set_timestamp(1_100);
        assert_eq!(pause::paused_secs(&e), 100);
        pause::start(&e);
        pause::end(&e);
        e.ledger().set_timestamp(2_000);
        pause::start(&e);
        e.ledger().set_timestamp(2_050);
        pause::end(&e);
        pause::end(&e);

        assert_eq!(pause::paused_secs(&e), 150);
    });
}
