use super::*;
use crate::clock::from_source;
use crate::setup::bind_source;

#[test]
fn an_unbound_contract_has_no_clock() {
    let e = Env::default();
    let follower = e.register(Follower, ());
    e.as_contract(&follower, || {
        assert_eq!(from_source(&e), Err(Refusal::Unbound));
    });
}

#[test]
fn a_bound_contract_reads_its_source_clock_as_it_changes() {
    let (e, source) = owner();
    let follower = e.register(Follower, ());
    e.as_contract(&follower, || bind_source(&e, &source).unwrap());

    let mut reported = clock(MIN_DELAY);
    reported.exit_window = 3_600;
    reported.paused_secs = 42;
    reported.paused = true;
    e.as_contract(&source, || set_clock(&e, &reported));

    assert_eq!(e.as_contract(&follower, || from_source(&e)), Ok(reported));
}
