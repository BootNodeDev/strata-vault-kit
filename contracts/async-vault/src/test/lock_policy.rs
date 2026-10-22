use super::*;
use crate::lock_policy::{self, Decision, Exit, Standing};

#[test]
fn a_listed_holder_may_request_a_deposit() {
    assert_eq!(
        lock_policy::decide(Exit::RequestDeposit, Standing::Listed),
        Decision::Proceed
    );
}

#[test]
fn a_delisted_holder_may_not_request_a_deposit() {
    assert_eq!(
        lock_policy::decide(Exit::RequestDeposit, Standing::Delisted),
        Decision::Refuse
    );
}

#[test]
fn standing_is_listed_for_an_allowlisted_holder() {
    let f = setup();
    let holder = f.investor(0);

    assert_eq!(
        f.e.as_contract(&f.vault.address, || lock_policy::standing(&f.e, &holder)),
        Standing::Listed
    );
}

#[test]
fn standing_is_delisted_for_an_address_that_was_never_allowlisted() {
    let f = setup();
    let stranger = f.unverified_investor(0);

    assert_eq!(
        f.e.as_contract(&f.vault.address, || lock_policy::standing(&f.e, &stranger)),
        Standing::Delisted
    );
}

#[test]
fn standing_is_delisted_for_a_holder_listed_then_removed() {
    let f = setup();
    let holder = f.investor(0);
    f.identity.allow(&holder, &false, &f.compliance);

    assert_eq!(
        f.e.as_contract(&f.vault.address, || lock_policy::standing(&f.e, &holder)),
        Standing::Delisted
    );
}
