extern crate std;

use ed25519_dalek::{Signer, SigningKey};
use soroban_sdk::{
    contract, contractimpl,
    testutils::{Address as _, Ledger, MockAuth, MockAuthInvoke},
    Address, Bytes, Env, Error, IntoVal, InvokeError,
};
use stellar_tokens::rwa::identity_verification::claim_issuer::{
    encode_claim_data_expiration, Ed25519Verifier, SignatureVerifier,
};

use crate::{
    ClaimIssuerContract, ClaimIssuerContractClient, ClaimIssuerContractError, ED25519_SCHEME,
    REFUSALS,
};

#[contract]
struct TopicsDouble;

#[contractimpl]
impl TopicsDouble {
    pub fn has_claim_topic(_e: &Env, _issuer: Address, _topic: u32) -> bool {
        true
    }
}

const TOPIC: u32 = 1;
const NOW: u64 = 1_000;
const IDENTITY: &str = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";
const ISSUER: &str = "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM";

struct Fixture<'a> {
    e: Env,
    owner: Address,
    registry: Address,
    identity: Address,
    key: SigningKey,
    issuer: ClaimIssuerContractClient<'a>,
}

fn fixture<'a>() -> Fixture<'a> {
    let e = Env::default();
    e.mock_all_auths();
    e.ledger().set_timestamp(NOW);
    let owner = Address::generate(&e);
    let registry = e.register(TopicsDouble, ());
    let at = Address::from_str(&e, ISSUER);
    let id = e.register_at(&at, ClaimIssuerContract, (&owner,));
    let issuer = ClaimIssuerContractClient::new(&e, &id);
    let key = SigningKey::from_bytes(&[7u8; 32]);
    let identity = Address::from_str(&e, IDENTITY);
    issuer.allow_key(&public_key(&e, &key), &registry, &TOPIC);
    Fixture {
        e,
        owner,
        registry,
        identity,
        key,
        issuer,
    }
}

fn public_key(e: &Env, key: &SigningKey) -> Bytes {
    Bytes::from_slice(e, key.verifying_key().as_bytes())
}

impl Fixture<'_> {
    fn claim_data(&self, created_at: u64, valid_until: u64) -> Bytes {
        encode_claim_data_expiration(
            &self.e,
            created_at,
            valid_until,
            &Bytes::from_slice(&self.e, b"kyc-level-1"),
        )
    }

    fn message(&self, claim_data: &Bytes) -> Bytes {
        self.e.as_contract(&self.issuer.address, || {
            Ed25519Verifier::build_message(&self.e, &self.identity, TOPIC, claim_data)
        })
    }

    fn sign(&self, key: &SigningKey, claim_data: &Bytes) -> Bytes {
        let message = to_vec(&self.message(claim_data));
        let signature = key.sign(&message);
        let mut sig_data = std::vec::Vec::new();
        sig_data.extend_from_slice(key.verifying_key().as_bytes());
        sig_data.extend_from_slice(&signature.to_bytes());
        Bytes::from_slice(&self.e, &sig_data)
    }

    fn check(
        &self,
        scheme: u32,
        sig_data: &Bytes,
        claim_data: &Bytes,
    ) -> Result<(), Result<Error, InvokeError>> {
        match self
            .issuer
            .try_is_claim_valid(&self.identity, &TOPIC, &scheme, sig_data, claim_data)
        {
            Ok(Ok(())) => Ok(()),
            Ok(Err(_)) => panic!("unexpected conversion error"),
            Err(error) => Err(error),
        }
    }
}

fn contract_code(error: &Result<Error, InvokeError>) -> Option<u32> {
    match error {
        Ok(error) => error
            .is_type(soroban_sdk::xdr::ScErrorType::Contract)
            .then(|| error.get_code()),
        Err(InvokeError::Contract(code)) => Some(*code),
        Err(_) => None,
    }
}

#[test]
fn a_claim_signed_by_an_allowed_key_is_valid() {
    let f = fixture();
    let data = f.claim_data(NOW, NOW + 100);
    let sig = f.sign(&f.key, &data);
    assert_eq!(f.check(ED25519_SCHEME, &sig, &data), Ok(()));

    std::eprintln!(
        "VECTOR network_id={}\nVECTOR issuer={ISSUER}\nVECTOR identity={IDENTITY}\nVECTOR topic={TOPIC} nonce=0\nVECTOR claim_data={}\nVECTOR message={}\nVECTOR sig_data={}",
        hex(&f.e.ledger().network_id().to_array()),
        hex(&to_vec(&data)),
        hex(&to_vec(&f.message(&data))),
        hex(&to_vec(&sig)),
    );
}

fn hex(bytes: &[u8]) -> std::string::String {
    bytes.iter().map(|b| std::format!("{b:02x}")).collect()
}

#[test]
fn an_expired_claim_is_refused_with_claim_expired() {
    let f = fixture();
    let data = f.claim_data(NOW - 100, NOW);
    let sig = f.sign(&f.key, &data);
    let error = f.check(ED25519_SCHEME, &sig, &data).unwrap_err();
    assert_eq!(
        contract_code(&error),
        Some(ClaimIssuerContractError::ClaimExpired as u32)
    );
}

#[test]
fn a_revoked_claim_is_refused_with_claim_revoked() {
    let f = fixture();
    let data = f.claim_data(NOW, NOW + 100);
    let sig = f.sign(&f.key, &data);
    f.issuer.revoke_claim(&f.identity, &TOPIC, &data);
    let error = f.check(ED25519_SCHEME, &sig, &data).unwrap_err();
    assert_eq!(
        contract_code(&error),
        Some(ClaimIssuerContractError::ClaimRevoked as u32)
    );
}

#[test]
fn a_bumped_nonce_invalidates_earlier_signatures() {
    let f = fixture();
    let earlier = f.claim_data(NOW, NOW + 1_000);
    let earlier_sig = f.sign(&f.key, &earlier);
    assert_eq!(f.check(ED25519_SCHEME, &earlier_sig, &earlier), Ok(()));

    f.issuer.invalidate_claims(&f.identity, &TOPIC);
    let error = f.check(ED25519_SCHEME, &earlier_sig, &earlier).unwrap_err();
    assert_eq!(
        contract_code(&error),
        Some(ClaimIssuerContractError::ClaimInvalidated as u32)
    );

    f.e.ledger().set_timestamp(NOW + 10);
    let later = f.claim_data(NOW + 10, NOW + 1_000);
    let later_sig = f.sign(&f.key, &later);
    assert_eq!(f.check(ED25519_SCHEME, &later_sig, &later), Ok(()));
}

#[test]
fn a_key_not_allowed_for_the_topic_is_refused() {
    let f = fixture();
    let other = SigningKey::from_bytes(&[9u8; 32]);
    let data = f.claim_data(NOW, NOW + 100);
    let sig = f.sign(&other, &data);
    let error = f.check(ED25519_SCHEME, &sig, &data).unwrap_err();
    assert_eq!(
        contract_code(&error),
        Some(ClaimIssuerContractError::KeyNotAllowed as u32)
    );

    f.issuer
        .remove_key(&public_key(&f.e, &f.key), &f.registry, &TOPIC);
    let sig = f.sign(&f.key, &data);
    let error = f.check(ED25519_SCHEME, &sig, &data).unwrap_err();
    assert_eq!(
        contract_code(&error),
        Some(ClaimIssuerContractError::KeyNotAllowed as u32)
    );
}

#[test]
fn another_scheme_is_refused() {
    let f = fixture();
    let data = f.claim_data(NOW, NOW + 100);
    let sig = f.sign(&f.key, &data);
    let error = f.check(102, &sig, &data).unwrap_err();
    assert_eq!(
        contract_code(&error),
        Some(ClaimIssuerContractError::UnsupportedScheme as u32)
    );
}

#[test]
fn a_tampered_payload_fails_the_signature() {
    let f = fixture();
    let data = f.claim_data(NOW, NOW + 100);
    let sig = f.sign(&f.key, &data);
    let mut tampered = to_vec(&data);
    let last = tampered.len() - 1;
    tampered[last] ^= 1;
    let tampered = Bytes::from_slice(&f.e, &tampered);
    let error = f.check(ED25519_SCHEME, &sig, &tampered).unwrap_err();
    std::eprintln!("TAMPER error = {error:?}");
    let code = contract_code(&error);
    assert!(code.is_none(), "unexpected contract error {code:?}");
}

#[test]
fn only_the_owner_manages_keys_and_revocations() {
    let f = fixture();
    let stranger = Address::generate(&f.e);
    let key = Bytes::from_slice(&f.e, &[1u8; 32]);
    let data = f.claim_data(NOW, NOW + 100);
    f.e.mock_auths(&[MockAuth {
        address: &stranger,
        invoke: &MockAuthInvoke {
            contract: &f.issuer.address,
            fn_name: "allow_key",
            args: (&key, &f.registry, &TOPIC).into_val(&f.e),
            sub_invokes: &[],
        },
    }]);
    assert!(f.issuer.try_allow_key(&key, &f.registry, &TOPIC).is_err());
    f.e.mock_auths(&[MockAuth {
        address: &stranger,
        invoke: &MockAuthInvoke {
            contract: &f.issuer.address,
            fn_name: "revoke_claim",
            args: (&f.identity, &TOPIC, &data).into_val(&f.e),
            sub_invokes: &[],
        },
    }]);
    assert!(f
        .issuer
        .try_revoke_claim(&f.identity, &TOPIC, &data)
        .is_err());
    f.e.mock_auths(&[MockAuth {
        address: &stranger,
        invoke: &MockAuthInvoke {
            contract: &f.issuer.address,
            fn_name: "invalidate_claims",
            args: (&f.identity, &TOPIC).into_val(&f.e),
            sub_invokes: &[],
        },
    }]);
    assert!(f.issuer.try_invalidate_claims(&f.identity, &TOPIC).is_err());
    assert_eq!(f.issuer.owner(), f.owner);
}

#[test]
fn the_refusal_codes_match_the_error_enum() {
    assert_eq!(
        REFUSALS,
        [
            ClaimIssuerContractError::UnsupportedScheme as u32,
            ClaimIssuerContractError::ClaimExpired as u32,
            ClaimIssuerContractError::ClaimRevoked as u32,
            ClaimIssuerContractError::KeyNotAllowed as u32,
            ClaimIssuerContractError::ClaimInvalidated as u32,
        ]
    );
}

fn to_vec(bytes: &Bytes) -> std::vec::Vec<u8> {
    let mut out = std::vec![0u8; bytes.len() as usize];
    bytes.copy_into_slice(&mut out);
    out
}
