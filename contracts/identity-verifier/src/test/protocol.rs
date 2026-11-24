//! Protocol addresses pass without a read: the bound vault always, and any
//! address governance names until it is removed.

use soroban_sdk::{
    testutils::{Address as _, Events as _},
    Address, Event as _,
};
use stellar_tokens::rwa::identity_verification::identity_registry_storage::IRSError;

use super::{
    bound, calls, contract_id, doubles, finished, refused, symbol, unbound, verified, Behaviour,
    Fixture, TokenSideClient,
};
use crate::{
    ProtocolAddressAdded, ProtocolAddressRemoved, VaultBound, VerifierChange, VerifierError,
};

impl Fixture<'_> {
    fn verifier_events(&self) -> soroban_sdk::testutils::ContractEvents {
        self.e
            .events()
            .all()
            .filter_by_contract(&self.verifier.address)
    }
}

#[test]
fn the_vault_is_verified_without_any_claim() {
    let f = unbound();
    refused(f.verify(&f.clock.address), IRSError::IdentityNotFound);

    f.verifier.bind_vault(&f.clock.address);

    verified(f.verify(&f.clock.address));
    assert_eq!(
        calls(&f.e),
        [(contract_id(&f.verifier.address), symbol("verify_identity"))]
    );
    assert!(f.verifier.is_protocol_address(&f.clock.address));
}

#[test]
fn the_vault_is_verified_while_every_contract_it_could_read_fails() {
    let d = doubles();
    d.registry.behave_as(&Behaviour::Traps);
    d.topics.behave_as(&Behaviour::Traps);

    verified(TokenSideClient::new(&d.e, &d.verifier.address).try_verify_identity(&d.clock.address));
}

#[test]
fn the_bound_vault_cannot_be_removed_as_protocol_address() {
    let f = bound();
    refused(
        f.verifier.try_remove_protocol_address(&f.clock.address),
        VerifierError::VaultIsProtocol,
    );

    f.verifier.finish_setup();

    refused(
        f.verifier
            .try_propose_change(&VerifierChange::RemoveProtocolAddress(
                f.clock.address.clone(),
            )),
        VerifierError::VaultIsProtocol,
    );
    assert!(f.verifier.is_protocol_address(&f.clock.address));
    verified(f.verify(&f.clock.address));
}

#[test]
fn a_named_protocol_address_is_verified_until_it_is_removed() {
    let f = bound();
    let escrow = Address::generate(&f.e);
    assert!(!f.verifier.is_protocol_address(&escrow));
    refused(f.verify(&escrow), IRSError::IdentityNotFound);

    f.verifier.add_protocol_address(&escrow);
    assert!(f.verifier.is_protocol_address(&escrow));
    verified(f.verify(&escrow));

    f.verifier.remove_protocol_address(&escrow);
    assert!(!f.verifier.is_protocol_address(&escrow));
    refused(f.verify(&escrow), IRSError::IdentityNotFound);
}

#[test]
fn after_setup_protocol_addresses_change_through_the_timelock() {
    let f = finished();
    let escrow = Address::generate(&f.e);
    refused(
        f.verifier.try_add_protocol_address(&escrow),
        VerifierError::UseTimelock,
    );
    refused(
        f.verifier.try_remove_protocol_address(&escrow),
        VerifierError::UseTimelock,
    );
    refused(
        f.verifier.try_remove_protocol_address(&f.clock.address),
        VerifierError::UseTimelock,
    );

    f.land(&VerifierChange::AddProtocolAddress(escrow.clone()));
    verified(f.verify(&escrow));

    f.land(&VerifierChange::RemoveProtocolAddress(escrow.clone()));
    refused(f.verify(&escrow), IRSError::IdentityNotFound);
}

#[test]
fn binding_the_vault_publishes_it_as_a_protocol_address() {
    let f = unbound();

    f.verifier.bind_vault(&f.clock.address);

    assert_eq!(
        f.verifier_events(),
        [
            VaultBound {
                vault: f.clock.address.clone()
            }
            .to_xdr(&f.e, &f.verifier.address),
            ProtocolAddressAdded {
                account: f.clock.address.clone()
            }
            .to_xdr(&f.e, &f.verifier.address),
        ]
    );
}

#[test]
fn a_vault_named_before_it_is_bound_is_published_once() {
    let f = unbound();
    f.verifier.add_protocol_address(&f.clock.address);

    f.verifier.bind_vault(&f.clock.address);

    assert_eq!(
        f.verifier_events(),
        [VaultBound {
            vault: f.clock.address.clone()
        }
        .to_xdr(&f.e, &f.verifier.address)]
    );
}

#[test]
fn only_a_real_change_is_published() {
    let f = bound();
    let escrow = Address::generate(&f.e);
    let added = ProtocolAddressAdded {
        account: escrow.clone(),
    }
    .to_xdr(&f.e, &f.verifier.address);
    let removed = ProtocolAddressRemoved {
        account: escrow.clone(),
    }
    .to_xdr(&f.e, &f.verifier.address);

    f.verifier.add_protocol_address(&escrow);
    assert_eq!(f.verifier_events(), core::slice::from_ref(&added));
    f.verifier.add_protocol_address(&escrow);
    assert_eq!(f.verifier_events().events().len(), 0);
    f.verifier.add_protocol_address(&f.clock.address);
    assert_eq!(f.verifier_events().events().len(), 0);

    f.verifier.remove_protocol_address(&escrow);
    assert_eq!(f.verifier_events(), core::slice::from_ref(&removed));
    f.verifier.remove_protocol_address(&escrow);
    assert_eq!(f.verifier_events().events().len(), 0);

    f.verifier.finish_setup();
    f.land(&VerifierChange::AddProtocolAddress(escrow.clone()));
    assert_eq!(f.verifier_events().events().first(), Some(&added));
    f.land(&VerifierChange::RemoveProtocolAddress(escrow));
    assert_eq!(f.verifier_events().events().first(), Some(&removed));
}
