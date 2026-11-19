//! `ready_for` holds only when governance admins all three contracts, every
//! required topic has an issuer, and the three are bound to the vault with
//! their setups closed and wired to each other. Each condition alone makes it
//! false, and no failed read fails the vault's call.

use soroban_sdk::{testutils::Address as _, Address};

use super::{
    account_address, running, unbound, ClockStub, ClockStubClient, Fixture, VerifierSetupClient,
    AML,
};
use crate::VerifierChange;

impl Fixture<'_> {
    fn ready_for(&self, vault: &Address, governance: &Address) -> bool {
        VerifierSetupClient::new(&self.e, &self.verifier.address).ready_for(vault, governance)
    }

    fn close_the_verifier(&self) {
        self.verifier.bind_vault(&self.clock.address);
        self.verifier.finish_setup();
    }

    fn another_vault(&self) -> Address {
        let other = ClockStubClient::new(&self.e, &self.e.register(ClockStub, ()));
        other.set(&running());
        other.address
    }

    /// Hands a contract's admin role to a stranger during its setup.
    fn hand_over(&self, transfer: impl FnOnce(&Address, &u32), accept: impl FnOnce()) {
        let stranger = Address::generate(&self.e);
        transfer(&stranger, &(self.e.ledger().sequence() + 100));
        accept();
    }
}

/// Every setup closed on the vault, after `before_closing` has run.
fn readied<'a>(before_closing: impl FnOnce(&Fixture)) -> Fixture<'a> {
    let f = unbound();
    before_closing(&f);
    f.close_the_stack();
    f.close_the_verifier();
    f
}

#[test]
fn ready_for_checks_admins_topics_and_the_vault() {
    let f = readied(|_| {});

    assert!(f.ready());
    assert!(!f.ready_for(&Address::generate(&f.e), &f.admin));
    assert!(!f.ready_for(&f.clock.address, &Address::generate(&f.e)));
}

#[test]
fn ready_for_needs_governance_to_admin_the_verifier() {
    let f = readied(|f| {
        f.hand_over(
            |next, until| f.verifier.transfer_admin_role(next, until),
            || f.verifier.accept_admin_transfer(),
        )
    });

    assert!(!f.ready());
}

#[test]
fn ready_for_needs_governance_to_admin_the_registry() {
    let f = readied(|f| {
        f.hand_over(
            |next, until| f.registry.transfer_admin_role(next, until),
            || f.registry.accept_admin_transfer(),
        )
    });

    assert!(!f.ready());
}

#[test]
fn ready_for_needs_governance_to_admin_the_topics() {
    let f = readied(|f| {
        f.hand_over(
            |next, until| f.topics.transfer_admin_role(next, until),
            || f.topics.accept_admin_transfer(),
        )
    });

    assert!(!f.ready());
}

#[test]
fn ready_for_needs_an_issuer_for_every_topic() {
    let f = readied(|f| f.topics.add_claim_topic(&AML, &f.admin));

    assert!(!f.ready());
}

#[test]
fn ready_for_needs_the_verifier_bound_with_setup_closed() {
    let f = unbound();
    f.close_the_stack();
    assert!(!f.ready());

    f.verifier.bind_vault(&f.clock.address);
    assert!(!f.ready());

    f.verifier.finish_setup();
    assert!(f.ready());
}

#[test]
fn ready_for_needs_the_verifier_bound_to_this_vault() {
    let f = unbound();
    f.close_the_stack();
    f.verifier.bind_vault(&f.another_vault());
    f.verifier.add_protocol_address(&f.clock.address);
    f.verifier.finish_setup();

    assert!(f.verifier.is_protocol_address(&f.clock.address));
    assert!(!f.ready());
}

#[test]
fn ready_for_needs_the_registry_bound_with_setup_closed() {
    let f = unbound();
    f.topics.bind_vault(&f.clock.address);
    f.topics.finish_setup();
    f.registry.bind_vault(&f.clock.address);
    f.close_the_verifier();
    assert!(!f.ready());

    f.registry.finish_setup();
    assert!(f.ready());
}

#[test]
fn ready_for_needs_the_registry_bound_to_this_vault() {
    let f = unbound();
    f.topics.bind_vault(&f.clock.address);
    f.topics.finish_setup();
    f.registry.bind_vault(&f.another_vault());
    f.registry.finish_setup();
    f.close_the_verifier();

    assert!(!f.ready());
}

#[test]
fn ready_for_needs_the_topics_bound_with_setup_closed() {
    let f = unbound();
    f.topics.bind_vault(&f.clock.address);
    f.registry.bind_vault(&f.clock.address);
    f.registry.finish_setup();
    f.close_the_verifier();
    assert!(!f.ready());

    f.topics.finish_setup();
    assert!(f.ready());
}

#[test]
fn ready_for_needs_the_topics_bound_to_this_vault() {
    let f = unbound();
    f.topics.bind_vault(&f.another_vault());
    f.topics.finish_setup();
    f.registry.bind_vault(&f.clock.address);
    f.registry.finish_setup();
    f.close_the_verifier();

    assert!(!f.ready());
}

#[test]
fn ready_for_needs_the_registry_to_ask_this_verifier() {
    let f = readied(|f| f.registry.bind_verifier(&Address::generate(&f.e)));

    assert!(!f.ready());
}

#[test]
fn ready_for_is_false_when_a_contract_does_not_answer() {
    let f = readied(|_| {});
    assert!(f.ready());
    let setup = VerifierSetupClient::new(&f.e, &f.verifier.address);

    f.land(&VerifierChange::Registry(Address::generate(&f.e)));
    assert_eq!(
        setup.try_ready_for(&f.clock.address, &f.admin),
        Ok(Ok(false))
    );

    f.land(&VerifierChange::Registry(account_address(&f.e)));
    assert_eq!(
        setup.try_ready_for(&f.clock.address, &f.admin),
        Ok(Ok(false))
    );

    f.land(&VerifierChange::Registry(f.registry.address.clone()));
    assert!(f.ready());
    f.land(&VerifierChange::Topics(Address::generate(&f.e)));
    assert_eq!(
        setup.try_ready_for(&f.clock.address, &f.admin),
        Ok(Ok(false))
    );
    f.land(&VerifierChange::Topics(account_address(&f.e)));
    assert_eq!(
        setup.try_ready_for(&f.clock.address, &f.admin),
        Ok(Ok(false))
    );
}
