//! A wallet lists itself, with claims a provider signed for its identity.

extern crate std;

use investor_identity::InvestorIdentityClient;
use soroban_sdk::{
    testutils::{
        Address as _, AuthorizedFunction, AuthorizedInvocation, Events as _, MockAuth,
        MockAuthInvoke,
    },
    vec, Address, ContractExecutable, Event as _, Executable, IntoVal, Symbol, Val, Vec,
};
use stellar_tokens::rwa::{
    identity_verification::{
        identity_claims::IdentityClaimsClient, identity_registry_storage::IRSError,
    },
    RWAError,
};

use super::{
    bound, deploy, finished, missing_auth, refused, unbound, Answer, ForeignIdentity, KYC,
};
use crate::{
    IdentityRegistered, IdentityRegistry, IdentityRegistryClient, IdentityRegistryError,
    SignedClaim,
};

#[test]
fn onboarding_deploys_the_identity_adds_claims_and_registers() {
    let f = bound();
    let account = Address::generate(&f.e);
    let claims = f.claims_of(&account);

    let identity = f.registry.onboard(&account, &claims);

    assert_eq!(
        f.e.events().all().filter_by_contract(&f.registry.address),
        [IdentityRegistered {
            account: account.clone(),
            identity: identity.clone()
        }
        .to_xdr(&f.e, &f.registry.address)]
    );
    assert_eq!(f.registry.stored_identity(&account), identity);
    assert_eq!(
        identity.executable(),
        Some(Executable::Wasm(f.identity_wasm.clone()))
    );
    assert_eq!(
        InvestorIdentityClient::new(&f.e, &identity).owner(),
        account
    );
    assert_eq!(
        IdentityClaimsClient::new(&f.e, &identity)
            .get_claim_ids_by_topic(&KYC)
            .len(),
        1
    );
    assert_eq!(f.verifier.accepted(), vec![&f.e, identity]);
}

#[test]
fn onboarding_without_a_valid_claim_reverts_and_registers_nothing() {
    let f = bound();
    let account = Address::generate(&f.e);
    let identity = f.registry.identity_address(&account);
    let elsewhere = f.claim_for(&Address::generate(&f.e));

    refused(
        f.registry.try_onboard(&account, &Vec::new(&f.e)),
        RWAError::IdentityVerificationFailed,
    );
    assert!(f
        .registry
        .try_onboard(&account, &vec![&f.e, elsewhere])
        .is_err());

    refused(
        f.registry.try_stored_identity(&account),
        IRSError::IdentityNotFound,
    );
    assert!(!identity.exists());
    assert_eq!(f.verifier.accepted().len(), 0);
}

#[test]
fn onboarding_reverts_when_the_verifier_refuses() {
    let f = bound();
    let account = Address::generate(&f.e);
    let claims = f.claims_of(&account);
    f.verifier.answer(&Answer::Nobody);

    refused(
        f.registry.try_onboard(&account, &claims),
        RWAError::IdentityVerificationFailed,
    );

    refused(
        f.registry.try_stored_identity(&account),
        IRSError::IdentityNotFound,
    );
    assert!(!f.registry.identity_address(&account).exists());
}

#[test]
fn onboarding_twice_is_refused() {
    let f = bound();
    let (account, identity) = f.onboarded();

    refused(
        f.registry.try_onboard(&account, &f.claims_of(&account)),
        IdentityRegistryError::AlreadyRegistered,
    );
    refused(
        f.registry.try_attach(&account, &identity),
        IdentityRegistryError::AlreadyRegistered,
    );
    assert_eq!(f.registry.stored_identity(&account), identity);
}

#[test]
fn the_predicted_identity_address_matches_the_deployed_one() {
    let f = bound();
    let first = Address::generate(&f.e);
    let second = Address::generate(&f.e);
    let predicted = f.registry.identity_address(&first);

    assert!(!predicted.exists());
    assert_eq!(f.registry.onboard(&first, &f.claims_of(&first)), predicted);
    assert_eq!(f.registry.identity_address(&first), predicted);
    assert_ne!(f.registry.identity_address(&second), predicted);
}

#[test]
fn attach_needs_the_identity_owner() {
    let f = bound();
    let account = Address::generate(&f.e);
    let someone_elses = f.own_identity(&Address::generate(&f.e));
    let own = f.own_identity(&account);

    refused(
        f.registry.try_attach(&account, &someone_elses),
        IdentityRegistryError::NotIdentityOwner,
    );
    refused(
        f.registry.try_stored_identity(&account),
        IRSError::IdentityNotFound,
    );

    f.registry.attach(&account, &own);

    assert_eq!(
        f.e.events().all().filter_by_contract(&f.registry.address),
        [IdentityRegistered {
            account: account.clone(),
            identity: own.clone()
        }
        .to_xdr(&f.e, &f.registry.address)]
    );
    assert_eq!(f.registry.stored_identity(&account), own);
    assert_eq!(f.verifier.accepted(), vec![&f.e, own]);
}

#[test]
fn attach_needs_the_kit_identity_code() {
    let f = bound();
    let account = Address::generate(&f.e);
    let registered = f.e.register(ForeignIdentity, (account.clone(),));
    let other_code = deploy(&f.e, &f.e.upload(ForeignIdentity), &account);
    let no_contract = Address::generate(&f.e);
    let none: Vec<Val> = Vec::new(&f.e);

    for identity in [&registered, &other_code, &no_contract] {
        refused(
            f.registry.try_attach(&account, identity),
            IdentityRegistryError::NotKitIdentity,
        );
        refused(
            f.registry
                .try_add_identity(&account, identity, &none, &f.compliance),
            IdentityRegistryError::NotKitIdentity,
        );
        refused(
            f.registry.try_batch_add_identity(
                &vec![&f.e, account.clone()],
                &vec![&f.e, identity.clone()],
                &vec![&f.e, none.clone()],
                &f.compliance,
            ),
            IdentityRegistryError::NotKitIdentity,
        );
    }
    let kit = f.own_identity(&account);
    f.registry.attach(&account, &kit);

    assert_eq!(f.registry.stored_identity(&account), kit);
}

#[test]
fn an_identity_whose_code_changed_is_not_found() {
    let f = bound();
    let (account, identity) = f.onboarded();
    let (other, other_identity) = f.onboarded();
    let swapped = f.e.upload(ForeignIdentity);

    f.e.as_contract(&identity, || {
        f.e.deployer()
            .update_current_contract(ContractExecutable::Wasm(swapped.clone()))
    });

    assert_eq!(identity.executable(), Some(Executable::Wasm(swapped)));
    refused(
        f.registry.try_stored_identity(&account),
        IRSError::IdentityNotFound,
    );
    assert_eq!(f.registry.stored_identity(&other), other_identity);
}

#[test]
fn attaching_an_identity_without_passing_claims_is_refused() {
    let f = bound();
    let account = Address::generate(&f.e);
    let empty = deploy(&f.e, &f.identity_wasm, &account);

    refused(
        f.registry.try_attach(&account, &empty),
        RWAError::IdentityVerificationFailed,
    );
    refused(
        f.registry.try_stored_identity(&account),
        IRSError::IdentityNotFound,
    );
}

#[test]
fn one_identity_serves_two_registries() {
    let f = bound();
    let (account, identity) = f.onboarded();
    let other = IdentityRegistryClient::new(
        &f.e,
        &f.e.register(
            IdentityRegistry,
            (
                f.admin.clone(),
                f.compliance.clone(),
                f.identity_wasm.clone(),
            ),
        ),
    );
    other.bind_vault(&f.clock.address);
    other.bind_verifier(&f.verifier.address);

    other.attach(&account, &identity);

    assert_eq!(f.registry.stored_identity(&account), identity);
    assert_eq!(other.stored_identity(&account), identity);
}

#[test]
fn no_wallet_is_linked_before_a_verifier_is_bound() {
    let f = unbound();
    let account = Address::generate(&f.e);
    let own = f.own_identity(&account);

    refused(
        f.registry.try_onboard(&account, &f.claims_of(&account)),
        IdentityRegistryError::VerifierNotBound,
    );
    refused(
        f.registry.try_attach(&account, &own),
        IdentityRegistryError::VerifierNotBound,
    );
    refused(
        f.registry
            .try_add_identity(&account, &own, &Vec::new(&f.e), &f.compliance),
        IdentityRegistryError::VerifierNotBound,
    );
    refused(
        f.registry.try_verifier(),
        IdentityRegistryError::VerifierNotBound,
    );
}

#[test]
fn onboarding_and_attaching_carry_on_during_a_wind_down() {
    let f = finished();
    f.wind_down();
    let (account, identity) = f.onboarded();
    let other = Address::generate(&f.e);
    let own = f.own_identity(&other);

    f.registry.attach(&other, &own);

    assert_eq!(f.registry.stored_identity(&account), identity);
    assert_eq!(f.registry.stored_identity(&other), own);
}

#[test]
fn only_the_wallet_onboards_or_attaches_itself() {
    let f = bound();
    let account = Address::generate(&f.e);
    let stranger = Address::generate(&f.e);
    let claims = f.claims_of(&account);
    let own = f.own_identity(&account);

    f.e.mock_auths(&[MockAuth {
        address: &stranger,
        invoke: &MockAuthInvoke {
            contract: &f.registry.address,
            fn_name: "onboard",
            args: (account.clone(), claims.clone()).into_val(&f.e),
            sub_invokes: &[],
        },
    }]);
    missing_auth(f.registry.try_onboard(&account, &claims));
    f.e.mock_auths(&[MockAuth {
        address: &stranger,
        invoke: &MockAuthInvoke {
            contract: &f.registry.address,
            fn_name: "attach",
            args: (account.clone(), own.clone()).into_val(&f.e),
            sub_invokes: &[],
        },
    }]);
    missing_auth(f.registry.try_attach(&account, &own));

    f.e.mock_all_auths();
    refused(
        f.registry.try_stored_identity(&account),
        IRSError::IdentityNotFound,
    );
}

/// The investor signs one entry: `onboard` at the root, with one `add_claim`
/// on the new identity below it for each claim.
#[test]
fn onboarding_asks_the_investor_for_one_signature() {
    let f = bound();
    let account = Address::generate(&f.e);
    let claims = f.claims_of(&account);
    let claim: SignedClaim = claims.get(0).unwrap();

    let identity = f.registry.onboard(&account, &claims);

    assert_eq!(
        f.e.auths(),
        std::vec![(
            account.clone(),
            AuthorizedInvocation {
                function: AuthorizedFunction::Contract((
                    f.registry.address.clone(),
                    Symbol::new(&f.e, "onboard"),
                    (account.clone(), claims.clone()).into_val(&f.e),
                )),
                sub_invocations: std::vec![AuthorizedInvocation {
                    function: AuthorizedFunction::Contract((
                        identity,
                        Symbol::new(&f.e, "add_claim"),
                        (
                            claim.topic,
                            claim.scheme,
                            claim.issuer,
                            claim.signature,
                            claim.data,
                            claim.uri
                        )
                            .into_val(&f.e),
                    )),
                    sub_invocations: std::vec![],
                }],
            },
        )]
    );
}

#[test]
fn attaching_asks_the_investor_for_one_signature() {
    let f = bound();
    let account = Address::generate(&f.e);
    let own = f.own_identity(&account);

    f.registry.attach(&account, &own);

    assert_eq!(
        f.e.auths(),
        std::vec![(
            account.clone(),
            AuthorizedInvocation {
                function: AuthorizedFunction::Contract((
                    f.registry.address.clone(),
                    Symbol::new(&f.e, "attach"),
                    (account, own).into_val(&f.e),
                )),
                sub_invocations: std::vec![],
            },
        )]
    );
}
