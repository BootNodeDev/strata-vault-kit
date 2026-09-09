extern crate std;

use soroban_sdk::{
    contract, contracttype,
    testutils::{
        storage::{Instance as _, Persistent as _},
        Ledger as _,
    },
    Address, Env,
};

use crate::{
    bump_instance, get_persistent, set_instance, set_persistent, INSTANCE_EXTEND_AMOUNT,
    PERSISTENT_EXTEND_AMOUNT, PERSISTENT_TTL_THRESHOLD,
};

#[contract]
struct Harness;

#[contracttype]
enum Key {
    Thing,
}

fn harness(e: &Env) -> Address {
    e.register(Harness, ())
}

#[test]
fn persistent_round_trips() {
    let e = Env::default();
    let id = harness(&e);

    e.as_contract(&id, || {
        assert_eq!(get_persistent::<_, i128>(&e, &Key::Thing), None);
        set_persistent(&e, &Key::Thing, &42i128);
        assert_eq!(get_persistent::<_, i128>(&e, &Key::Thing), Some(42));
    });
}

#[test]
fn writing_sets_the_full_ttl() {
    let e = Env::default();
    let id = harness(&e);

    e.as_contract(&id, || {
        set_persistent(&e, &Key::Thing, &1i128);
        assert_eq!(
            e.storage().persistent().get_ttl(&Key::Thing),
            PERSISTENT_EXTEND_AMOUNT
        );
    });
}

#[test]
fn reading_a_decayed_entry_restores_the_full_ttl() {
    let e = Env::default();
    let id = harness(&e);

    e.as_contract(&id, || set_persistent(&e, &Key::Thing, &1i128));

    let decay = PERSISTENT_EXTEND_AMOUNT - PERSISTENT_TTL_THRESHOLD + 1;
    e.ledger().with_mut(|l| l.sequence_number += decay);

    e.as_contract(&id, || {
        assert_eq!(
            e.storage().persistent().get_ttl(&Key::Thing),
            PERSISTENT_EXTEND_AMOUNT - decay
        );
        assert_eq!(get_persistent::<_, i128>(&e, &Key::Thing), Some(1));
        assert_eq!(
            e.storage().persistent().get_ttl(&Key::Thing),
            PERSISTENT_EXTEND_AMOUNT
        );
    });
}

#[test]
fn reading_a_missing_entry_creates_nothing() {
    let e = Env::default();
    let id = harness(&e);

    e.as_contract(&id, || {
        assert_eq!(get_persistent::<_, i128>(&e, &Key::Thing), None);
        assert!(!e.storage().persistent().has(&Key::Thing));
    });
}

#[test]
fn instance_writes_bump_the_instance() {
    let e = Env::default();
    let id = harness(&e);

    e.ledger().with_mut(|l| l.sequence_number += 1_000);

    e.as_contract(&id, || {
        set_instance(&e, &Key::Thing, &7i128);
        bump_instance(&e);
        assert_eq!(e.storage().instance().get::<_, i128>(&Key::Thing), Some(7));
    });

    assert_eq!(
        e.as_contract(&id, || e.storage().instance().get_ttl()),
        INSTANCE_EXTEND_AMOUNT
    );
}
