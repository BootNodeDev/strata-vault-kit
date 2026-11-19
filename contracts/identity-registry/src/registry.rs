use soroban_sdk::{
    contracttype, symbol_short, xdr::ToXdr, Address, BytesN, ContractExecutable, Env, Vec,
};
use stellar_tokens::rwa::identity_verification::identity_claims::IdentityClaimsClient;
use strata_bindings::ClaimsCheckClient;

use crate::governance;
use crate::{IdentityRegistered, IdentityRemoved, SignedClaim, VetoSet};

#[contracttype]
pub(crate) enum DataKey {
    Link(Address),
    Veto(Address),
}

fn salt(e: &Env, account: &Address) -> BytesN<32> {
    e.crypto().sha256(&account.clone().to_xdr(e)).to_bytes()
}

pub(crate) fn identity_address(e: &Env, account: &Address) -> Address {
    e.deployer()
        .with_current_contract(salt(e, account))
        .deployed_address()
}

/// Deploys the identity `account` owns, unless an earlier onboarding of the
/// same wallet already did.
pub(crate) fn deploy_identity(e: &Env, account: &Address) -> Address {
    let deployer = e.deployer().with_current_contract(salt(e, account));
    let identity = deployer.deployed_address();
    if identity.exists() {
        return identity;
    }
    deployer.deploy_contract(
        ContractExecutable::Wasm(governance::identity_wasm(e)),
        (account.clone(),),
    )
}

pub(crate) fn add_claims(e: &Env, identity: &Address, claims: &Vec<SignedClaim>) {
    let client = IdentityClaimsClient::new(e, identity);
    for claim in claims.iter() {
        client.add_claim(
            &claim.topic,
            &claim.scheme,
            &claim.issuer,
            &claim.signature,
            &claim.data,
            &claim.uri,
        );
    }
}

/// The identity's owner, or `None` when `identity` does not answer `owner`.
pub(crate) fn owner_of(e: &Env, identity: &Address) -> Option<Address> {
    e.try_invoke_contract::<Address, soroban_sdk::Error>(
        identity,
        &symbol_short!("owner"),
        Vec::new(e),
    )
    .ok()
    .and_then(Result::ok)
}

/// Links `account` to `identity` once the verifier accepts the identity's
/// claims; a refusal or a fault there reverts the whole call.
pub(crate) fn register(e: &Env, account: &Address, identity: &Address) {
    ClaimsCheckClient::new(e, &governance::verifier(e)).check_claims(identity);
    strata_storage::set_persistent(e, &DataKey::Link(account.clone()), identity);
    IdentityRegistered {
        account: account.clone(),
        identity: identity.clone(),
    }
    .publish(e);
}

pub(crate) fn identity_of(e: &Env, account: &Address) -> Option<Address> {
    strata_storage::get_persistent(e, &DataKey::Link(account.clone()))
}

pub(crate) fn unlink(e: &Env, account: &Address) {
    let key = DataKey::Link(account.clone());
    if e.storage().persistent().has(&key) {
        e.storage().persistent().remove(&key);
        IdentityRemoved {
            account: account.clone(),
        }
        .publish(e);
    }
}

pub(crate) fn veto(e: &Env, account: &Address) {
    strata_storage::set_persistent(e, &DataKey::Veto(account.clone()), &true);
    VetoSet {
        account: account.clone(),
        vetoed: true,
    }
    .publish(e);
}

pub(crate) fn lift_veto(e: &Env, account: &Address) {
    let key = DataKey::Veto(account.clone());
    if e.storage().persistent().has(&key) {
        e.storage().persistent().remove(&key);
        VetoSet {
            account: account.clone(),
            vetoed: false,
        }
        .publish(e);
    }
}

pub(crate) fn is_vetoed(e: &Env, account: &Address) -> bool {
    strata_storage::get_persistent::<_, bool>(e, &DataKey::Veto(account.clone())).unwrap_or(false)
}
