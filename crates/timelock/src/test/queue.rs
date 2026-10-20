use soroban_sdk::{testutils::Address as _, vec};

use super::*;
use crate::queue::{cancel, open_ids, pending, propose, take_ready, MAX_PENDING};

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
enum Change {
    Upgrade(u32),
    Rotate(Address),
}

#[test]
fn a_change_lands_one_delay_after_it_was_proposed() {
    let (e, id) = ready_owner();
    e.as_contract(&id, || {
        let change_id = propose::<Owner, _>(&e, &Change::Upgrade(2)).unwrap();

        assert_eq!(
            take_ready::<Owner, Change>(&e, change_id),
            Err(Refusal::NotElapsed)
        );
        e.ledger().set_timestamp(1_000 + MIN_DELAY);
        assert_eq!(
            take_ready::<Owner, Change>(&e, change_id),
            Ok(Change::Upgrade(2))
        );
        assert_eq!(pending::<Change>(&e, change_id), None);
    });
}

#[test]
fn nothing_is_proposed_while_setup_is_open() {
    let (e, id) = owner();
    e.as_contract(&id, || {
        assert_eq!(
            propose::<Owner, _>(&e, &Change::Upgrade(2)),
            Err(Refusal::SetupOpen)
        );
        assert_eq!(open_ids(&e).len(), 0);
    });
}

#[test]
fn nothing_is_proposed_during_a_wind_down() {
    let (e, id) = ready_owner();
    e.as_contract(&id, || {
        let mut c = clock(MIN_DELAY);
        c.winding_down = true;
        set_clock(&e, &c);

        assert_eq!(
            propose::<Owner, _>(&e, &Change::Upgrade(2)),
            Err(Refusal::WindingDown)
        );
        assert_eq!(open_ids(&e).len(), 0);
    });
}

#[test]
fn several_changes_wait_at_once_and_cancel_independently() {
    let (e, id) = ready_owner();
    e.as_contract(&id, || {
        let first = propose::<Owner, _>(&e, &Change::Upgrade(2)).unwrap();
        let second = propose::<Owner, _>(&e, &Change::Rotate(Address::generate(&e))).unwrap();
        assert_ne!(first, second);

        cancel(&e, first).unwrap();

        assert_eq!(open_ids(&e), vec![&e, second]);
        assert_eq!(cancel(&e, first), Err(Refusal::NotFound));
        assert!(pending::<Change>(&e, second).is_some());
    });
}

#[test]
fn the_queue_holds_at_most_max_pending() {
    let (e, id) = ready_owner();
    e.as_contract(&id, || {
        for n in 0..MAX_PENDING {
            propose::<Owner, _>(&e, &Change::Upgrade(n)).unwrap();
        }
        assert_eq!(
            propose::<Owner, _>(&e, &Change::Upgrade(99)),
            Err(Refusal::TooMany)
        );
    });
}

#[test]
fn a_cancelled_id_is_never_handed_out_again() {
    let (e, id) = ready_owner();
    e.as_contract(&id, || {
        let first = propose::<Owner, _>(&e, &Change::Upgrade(1)).unwrap();
        cancel(&e, first).unwrap();
        let second = propose::<Owner, _>(&e, &Change::Upgrade(1)).unwrap();
        assert!(second > first);
    });
}
