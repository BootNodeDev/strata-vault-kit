//! The compliance authority lists, delists and vetoes wallets at once.

extern crate std;

use soroban_sdk::{
    testutils::{Address as _, Events as _, MockAuth, MockAuthInvoke},
    vec,
    xdr::{ContractEventBody, ScVal},
    Address, Env, Event as _, IntoVal, Val, Vec,
};
use stellar_tokens::rwa::{identity_verification::identity_registry_storage::IRSError, RWAError};

use super::{bound, deploy, finished, missing_auth, refused, Answer, Fixture};
use crate::{IdentityRegistered, IdentityRegistryError, IdentityRemoved, VetoSet};

impl Fixture<'_> {
    fn no_country_data(&self) -> Vec<Val> {
        Vec::new(&self.e)
    }

    fn list(&self, account: &Address, identity: &Address) {
        self.registry
            .add_identity(account, identity, &self.no_country_data(), &self.compliance);
    }

    fn delist(&self, account: &Address) {
        self.registry.remove_identity(account, &self.compliance);
    }

    fn registry_events(&self) -> soroban_sdk::testutils::ContractEvents {
        self.e
            .events()
            .all()
            .filter_by_contract(&self.registry.address)
    }
}

#[test]
fn removal_vetoes_and_a_vetoed_wallet_cannot_onboard_or_attach() {
    let f = bound();
    let (account, identity) = f.onboarded();

    f.delist(&account);

    assert_eq!(
        f.registry_events(),
        [
            IdentityRemoved {
                account: account.clone()
            }
            .to_xdr(&f.e, &f.registry.address),
            VetoSet {
                account: account.clone(),
                vetoed: true
            }
            .to_xdr(&f.e, &f.registry.address),
        ]
    );
    assert!(f.registry.is_vetoed(&account));
    refused(
        f.registry.try_stored_identity(&account),
        IRSError::IdentityNotFound,
    );
    refused(
        f.registry.try_onboard(&account, &f.claims_of(&account)),
        IdentityRegistryError::Vetoed,
    );
    refused(
        f.registry.try_attach(&account, &identity),
        IdentityRegistryError::Vetoed,
    );
    refused(
        f.registry
            .try_add_identity(&account, &identity, &f.no_country_data(), &f.compliance),
        IdentityRegistryError::Vetoed,
    );
    refused(
        f.registry.try_stored_identity(&account),
        IRSError::IdentityNotFound,
    );
}

#[test]
fn only_compliance_lifts_a_veto() {
    let f = bound();
    let (account, _) = f.onboarded();
    f.delist(&account);
    let stranger = Address::generate(&f.e);

    for operator in [&stranger, &f.admin] {
        refused(
            f.registry.try_lift_veto(&account, operator),
            IdentityRegistryError::OperatorNotCompliance,
        );
    }
    f.e.mock_auths(&[MockAuth {
        address: &stranger,
        invoke: &MockAuthInvoke {
            contract: &f.registry.address,
            fn_name: "lift_veto",
            args: (account.clone(), f.compliance.clone()).into_val(&f.e),
            sub_invokes: &[],
        },
    }]);
    missing_auth(f.registry.try_lift_veto(&account, &f.compliance));
    f.e.mock_all_auths();
    assert!(f.registry.is_vetoed(&account));

    f.registry.lift_veto(&account, &f.compliance);

    assert_eq!(
        f.registry_events(),
        [VetoSet {
            account: account.clone(),
            vetoed: false
        }
        .to_xdr(&f.e, &f.registry.address)]
    );
    assert!(!f.registry.is_vetoed(&account));
    f.registry.lift_veto(&account, &f.compliance);
    assert_eq!(f.registry_events().events().len(), 0);
}

#[test]
fn onboarding_again_after_a_lifted_veto_keeps_the_identity() {
    let f = bound();
    let (account, identity) = f.onboarded();
    f.delist(&account);
    f.registry.lift_veto(&account, &f.compliance);

    assert_eq!(
        f.registry.onboard(&account, &f.claims_of(&account)),
        identity
    );

    assert_eq!(f.registry.stored_identity(&account), identity);
}

#[test]
fn a_wallet_can_be_vetoed_before_it_onboards() {
    let f = bound();
    let account = Address::generate(&f.e);

    f.delist(&account);

    assert_eq!(
        f.registry_events(),
        [VetoSet {
            account: account.clone(),
            vetoed: true
        }
        .to_xdr(&f.e, &f.registry.address)]
    );
    refused(
        f.registry.try_onboard(&account, &f.claims_of(&account)),
        IdentityRegistryError::Vetoed,
    );
}

#[test]
fn only_compliance_lists_and_delists() {
    let f = bound();
    let (listed, _) = f.onboarded();
    let account = Address::generate(&f.e);
    let identity = f.own_identity(&account);
    let stranger = Address::generate(&f.e);

    for operator in [&stranger, &f.admin] {
        refused(
            f.registry
                .try_add_identity(&account, &identity, &f.no_country_data(), operator),
            IdentityRegistryError::OperatorNotCompliance,
        );
        refused(
            f.registry.try_batch_add_identity(
                &vec![&f.e, account.clone()],
                &vec![&f.e, identity.clone()],
                &vec![&f.e, f.no_country_data()],
                operator,
            ),
            IdentityRegistryError::OperatorNotCompliance,
        );
        refused(
            f.registry.try_remove_identity(&listed, operator),
            IdentityRegistryError::OperatorNotCompliance,
        );
    }

    f.e.mock_auths(&[MockAuth {
        address: &stranger,
        invoke: &MockAuthInvoke {
            contract: &f.registry.address,
            fn_name: "add_identity",
            args: (
                account.clone(),
                identity.clone(),
                f.no_country_data(),
                f.compliance.clone(),
            )
                .into_val(&f.e),
            sub_invokes: &[],
        },
    }]);
    missing_auth(f.registry.try_add_identity(
        &account,
        &identity,
        &f.no_country_data(),
        &f.compliance,
    ));
    f.e.mock_auths(&[MockAuth {
        address: &stranger,
        invoke: &MockAuthInvoke {
            contract: &f.registry.address,
            fn_name: "remove_identity",
            args: (listed.clone(), f.compliance.clone()).into_val(&f.e),
            sub_invokes: &[],
        },
    }]);
    missing_auth(f.registry.try_remove_identity(&listed, &f.compliance));
    f.e.mock_all_auths();

    assert!(!f.registry.is_vetoed(&listed));
    refused(
        f.registry.try_stored_identity(&account),
        IRSError::IdentityNotFound,
    );
}

#[test]
fn compliance_lists_a_wallet_whose_claims_pass() {
    let f = bound();
    let account = Address::generate(&f.e);
    let identity = f.own_identity(&account);
    let bare = Address::generate(&f.e);
    let empty = deploy(&f.e, &f.identity_wasm, &bare);

    refused(
        f.registry
            .try_add_identity(&bare, &empty, &f.no_country_data(), &f.compliance),
        RWAError::IdentityVerificationFailed,
    );
    f.list(&account, &identity);

    assert_eq!(
        f.registry_events(),
        [IdentityRegistered {
            account: account.clone(),
            identity: identity.clone()
        }
        .to_xdr(&f.e, &f.registry.address)]
    );
    assert_eq!(f.registry.stored_identity(&account), identity);
    refused(
        f.registry
            .try_add_identity(&account, &identity, &f.no_country_data(), &f.compliance),
        IdentityRegistryError::AlreadyRegistered,
    );
    refused(
        f.registry.try_stored_identity(&bare),
        IRSError::IdentityNotFound,
    );
}

#[test]
fn a_batch_lists_every_wallet_or_none() {
    let f = bound();
    let first = Address::generate(&f.e);
    let second = Address::generate(&f.e);
    let first_identity = f.own_identity(&first);
    let second_identity = f.own_identity(&second);
    let vetoed = Address::generate(&f.e);
    let vetoed_identity = f.own_identity(&vetoed);
    f.delist(&vetoed);
    let none = f.no_country_data();

    refused(
        f.registry.try_batch_add_identity(
            &vec![&f.e, first.clone(), second.clone()],
            &vec![&f.e, first_identity.clone()],
            &vec![&f.e, none.clone(), none.clone()],
            &f.compliance,
        ),
        IRSError::BatchSizeMismatch,
    );
    refused(
        f.registry.try_batch_add_identity(
            &vec![&f.e, first.clone(), vetoed.clone()],
            &vec![&f.e, first_identity.clone(), vetoed_identity],
            &vec![&f.e, none.clone(), none.clone()],
            &f.compliance,
        ),
        IdentityRegistryError::Vetoed,
    );
    refused(
        f.registry.try_batch_add_identity(
            &vec![&f.e, first.clone(), first.clone()],
            &vec![&f.e, first_identity.clone(), first_identity.clone()],
            &vec![&f.e, none.clone(), none.clone()],
            &f.compliance,
        ),
        IdentityRegistryError::AlreadyRegistered,
    );
    f.verifier.answer(&Answer::Nobody);
    refused(
        f.registry.try_batch_add_identity(
            &vec![&f.e, first.clone()],
            &vec![&f.e, first_identity.clone()],
            &vec![&f.e, none.clone()],
            &f.compliance,
        ),
        RWAError::IdentityVerificationFailed,
    );
    refused(
        f.registry.try_stored_identity(&first),
        IRSError::IdentityNotFound,
    );
    f.verifier.answer(&Answer::ClaimOnKyc);

    f.registry.batch_add_identity(
        &vec![&f.e, first.clone(), second.clone()],
        &vec![&f.e, first_identity.clone(), second_identity.clone()],
        &vec![&f.e, none.clone(), none],
        &f.compliance,
    );

    assert_eq!(f.registry.stored_identity(&first), first_identity);
    assert_eq!(f.registry.stored_identity(&second), second_identity);
}

#[test]
fn country_data_is_refused() {
    let f = bound();
    let account = Address::generate(&f.e);
    let identity = f.own_identity(&account);
    let some: Vec<Val> = vec![&f.e, 840u32.into_val(&f.e)];

    refused(
        f.registry
            .try_add_identity(&account, &identity, &some, &f.compliance),
        IdentityRegistryError::CountryDataNotStored,
    );
    refused(
        f.registry.try_batch_add_identity(
            &vec![&f.e, account.clone()],
            &vec![&f.e, identity.clone()],
            &vec![&f.e, some],
            &f.compliance,
        ),
        IdentityRegistryError::CountryDataNotStored,
    );
    refused(
        f.registry.try_stored_identity(&account),
        IRSError::IdentityNotFound,
    );

    f.list(&account, &identity);
    assert_eq!(f.registry.stored_identity(&account), identity);
}

#[test]
fn recovery_is_not_offered() {
    let f = bound();
    let (account, _) = f.onboarded();
    let new_wallet = Address::generate(&f.e);

    refused(
        f.registry
            .try_recover_identity(&account, &new_wallet, &f.compliance),
        IdentityRegistryError::RecoveryNotOffered,
    );
    assert_eq!(f.registry.get_recovered_to(&account), None);
}

#[test]
fn token_binding_is_not_offered() {
    let f = bound();
    let token = Address::generate(&f.e);

    refused(
        f.registry.try_bind_token(&token, &f.admin),
        IdentityRegistryError::TokenBindingNotOffered,
    );
    refused(
        f.registry.try_unbind_token(&token, &f.admin),
        IdentityRegistryError::TokenBindingNotOffered,
    );
    assert_eq!(f.registry.linked_tokens().len(), 0);
}

#[test]
fn an_unknown_account_is_identity_not_found_321() {
    let f = bound();

    let refusal = f
        .registry
        .try_stored_identity(&Address::generate(&f.e))
        .unwrap_err()
        .unwrap();

    assert_eq!(refusal, IRSError::IdentityNotFound.into());
    assert_eq!(refusal.get_code(), 321);
}

fn symbol(name: &str) -> ScVal {
    ScVal::Symbol(name.try_into().unwrap())
}

/// The function of every contract call the last top-level call made,
/// itself included.
fn calls(e: &Env) -> std::vec::Vec<ScVal> {
    e.host()
        .get_diagnostic_events()
        .unwrap()
        .0
        .into_iter()
        .filter_map(|event| {
            let ContractEventBody::V0(body) = event.event.body;
            let topics = body.topics.to_vec();
            (topics.first() == Some(&symbol("fn_call"))).then(|| topics[2].clone())
        })
        .collect()
}

#[test]
fn stored_identity_calls_no_other_contract() {
    let f = bound();
    let (account, identity) = f.onboarded();
    assert!(calls(&f.e).contains(&symbol("check_claims")));
    f.verifier.answer(&Answer::Nobody);

    assert_eq!(f.registry.stored_identity(&account), identity);

    assert_eq!(calls(&f.e), [symbol("stored_identity")]);
}

#[test]
fn delisting_and_lifting_act_at_once_during_a_wind_down() {
    let f = finished();
    let (account, _) = f.onboarded();
    let other = Address::generate(&f.e);
    let other_identity = f.own_identity(&other);
    f.wind_down();

    f.delist(&account);
    assert!(f.registry.is_vetoed(&account));
    f.registry.lift_veto(&account, &f.compliance);
    assert!(!f.registry.is_vetoed(&account));
    f.list(&other, &other_identity);

    assert_eq!(f.registry.stored_identity(&other), other_identity);
}
