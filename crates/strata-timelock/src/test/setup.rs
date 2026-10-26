use soroban_sdk::testutils::Address as _;

use super::*;
use crate::setup::{bind_source, finish, is_open, source};

#[test]
fn the_setup_window_closes_once() {
    let (e, id) = owner();
    e.as_contract(&id, || {
        assert!(is_open(&e));

        assert_eq!(finish::<Owner>(&e), Ok(()));
        assert!(!is_open(&e));
        assert_eq!(finish::<Owner>(&e), Err(Refusal::SetupClosed));
    });
}

#[test]
fn a_bound_contract_cannot_finish_setup_unbound() {
    let e = Env::default();
    let follower = e.register(Follower, ());
    e.as_contract(&follower, || {
        assert_eq!(finish::<Follower>(&e), Err(Refusal::Unbound));
        assert!(is_open(&e));
    });
}

#[test]
fn a_contract_binds_one_source() {
    let (e, first) = owner();
    let second = e.register(Owner, ());
    let follower = e.register(Follower, ());
    e.as_contract(&follower, || {
        assert_eq!(source(&e), None);
        assert_eq!(bind_source(&e, &first), Ok(()));
        assert_eq!(bind_source(&e, &second), Err(Refusal::AlreadyBound));
        assert_eq!(source(&e), Some(first.clone()));
    });
}

#[test]
fn nothing_binds_once_setup_is_finished() {
    let (e, first) = owner();
    let second = e.register(Owner, ());
    let follower = e.register(Follower, ());
    e.as_contract(&follower, || {
        bind_source(&e, &first).unwrap();
        finish::<Follower>(&e).unwrap();

        assert_eq!(bind_source(&e, &second), Err(Refusal::SetupClosed));
        assert_eq!(source(&e), Some(first.clone()));
    });
}

#[test]
fn binding_refuses_an_address_that_is_not_a_clock_source() {
    let (e, clock_source) = owner();
    let follower = FollowerClient::new(&e, &e.register(Follower, ()));
    let no_clock = e.register(Follower, ());
    let no_contract = Address::generate(&e);

    assert!(follower.try_bind(&no_clock).is_err());
    assert!(follower.try_bind(&no_contract).is_err());
    assert_eq!(e.as_contract(&follower.address, || source(&e)), None);

    follower.bind(&clock_source);
    assert_eq!(
        e.as_contract(&follower.address, || source(&e)),
        Some(clock_source)
    );
}
