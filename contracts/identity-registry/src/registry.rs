use soroban_sdk::{
    contracttype, panic_with_error, symbol_short, xdr::ToXdr, Address, BytesN, ContractExecutable,
    Env, Executable, Vec,
};
use stellar_tokens::rwa::identity_verification::identity_claims::IdentityClaimsClient;
use strata_bindings::ClaimsCheckClient;

use crate::governance;
use crate::{IdentityRegistered, IdentityRegistryError, IdentityRemoved, SignedClaim, VetoSet};

#[contracttype]
pub(crate) enum DataKey {
    Link(Address),
    Veto(Address),
}

/// A wallet's identity and the code hash the identity ran when it was linked.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct LinkedIdentity {
    pub identity: Address,
    pub code: BytesN<32>,
}

fn salt(e: &Env, account: &Address) -> BytesN<32> {
    e.crypto().sha256(&account.clone().to_xdr(e)).to_bytes()
}

pub(crate) fn identity_address(e: &Env, account: &Address) -> Address {
    e.deployer()
        .with_current_contract(salt(e, account))
        .deployed_address()
}

/// The Wasm hash `identity` runs now, or `None` when it is not a Wasm
/// contract.
pub(crate) fn code_of(identity: &Address) -> Option<BytesN<32>> {
    match identity.executable() {
        Some(Executable::Wasm(code)) => Some(code),
        _ => None,
    }
}

/// Deploys the identity `account` owns, unless an earlier onboarding of the
/// same wallet already did, and returns it with the code it runs.
pub(crate) fn deploy_identity(e: &Env, account: &Address) -> (Address, BytesN<32>) {
    let deployer = e.deployer().with_current_contract(salt(e, account));
    let identity = deployer.deployed_address();
    if identity.exists() {
        let code = code_of(&identity)
            .unwrap_or_else(|| panic_with_error!(e, IdentityRegistryError::NotKitIdentity));
        return (identity, code);
    }
    let code = governance::identity_wasm(e);
    let identity =
        deployer.deploy_contract(ContractExecutable::Wasm(code.clone()), (account.clone(),));
    (identity, code)
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

pub(crate) fn owner_of(e: &Env, identity: &Address) -> Address {
    e.invoke_contract(identity, &symbol_short!("owner"), Vec::new(e))
}

/// Links `account` to `identity`, running `code`, once the verifier accepts
/// the identity's claims; a refusal or a fault there reverts the whole call.
pub(crate) fn register(e: &Env, account: &Address, identity: &Address, code: BytesN<32>) {
    ClaimsCheckClient::new(e, &governance::verifier(e)).check_claims(identity);
    let link = LinkedIdentity {
        identity: identity.clone(),
        code,
    };
    strata_storage::set_persistent(e, &DataKey::Link(account.clone()), &link);
    IdentityRegistered {
        account: account.clone(),
        identity: identity.clone(),
    }
    .publish(e);
}

pub(crate) fn link_of(e: &Env, account: &Address) -> Option<LinkedIdentity> {
    strata_storage::get_persistent(e, &DataKey::Link(account.clone()))
}

/// The identity linked to `account`, while it still runs the code it ran
/// when it was linked.
pub(crate) fn identity_of(e: &Env, account: &Address) -> Option<Address> {
    link_of(e, account)
        .filter(|link| code_of(&link.identity).as_ref() == Some(&link.code))
        .map(|link| link.identity)
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
