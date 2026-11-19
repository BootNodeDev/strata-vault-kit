extern crate std;

mod changes;
mod guards;
mod onboarding;
mod platform;
mod ttl;

use claim_issuer::{ClaimIssuerContract, ClaimIssuerContractClient, ED25519_SCHEME};
use claim_topics::{ClaimTopics, ClaimTopicsClient};
use ed25519_dalek::{Signer, SigningKey};
use investor_identity::InvestorIdentity;
use soroban_sdk::{
    contract, contractimpl, contracttype, panic_with_error, symbol_short,
    testutils::{storage::Instance as _, Address as _, Ledger as _},
    vec, Address, Bytes, BytesN, ContractExecutable, Env, String, Vec,
};
use stellar_tokens::rwa::{
    identity_verification::{
        claim_issuer::{encode_claim_data_expiration, Ed25519Verifier, SignatureVerifier},
        identity_claims::IdentityClaimsClient,
    },
    RWAError,
};
use strata_storage::INSTANCE_EXTEND_AMOUNT;
use strata_timelock::{Clock, MIN_DELAY};

use crate::{IdentityRegistry, IdentityRegistryClient, RegistryChange, SignedClaim};

const KYC: u32 = 1;
const NOW: u64 = 10_000;
const YEAR: u64 = 365 * 86_400;
const TWO_DAYS_IN_LEDGERS: u32 = 2 * 17_280;

/// Plays the vault: reports whatever clock a test sets, and counts the reads.
#[contract]
struct ClockStub;

#[contractimpl]
impl ClockStub {
    pub fn set(e: Env, clock: Clock) {
        e.storage().instance().set(&symbol_short!("clock"), &clock);
    }

    pub fn reads(e: Env) -> u32 {
        e.storage()
            .instance()
            .get(&symbol_short!("reads"))
            .unwrap_or(0)
    }
}

#[contractimpl(contracttrait)]
impl strata_timelock::ClockSource for ClockStub {
    fn timelock_clock(e: &Env) -> Clock {
        let reads = Self::reads(e.clone()) + 1;
        e.storage().instance().set(&symbol_short!("reads"), &reads);
        e.storage().instance().get(&symbol_short!("clock")).unwrap()
    }
}

/// How the verifier double answers `check_claims`.
#[contracttype]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum Answer {
    /// Accepts an identity holding a claim on `KYC`, as the real verifier
    /// would with that one required topic.
    ClaimOnKyc,
    /// Accepts every identity without reading it.
    Everyone,
    /// Refuses every identity.
    Nobody,
}

/// Plays the identity verifier, and records each identity it accepted.
#[contract]
struct VerifierDouble;

#[contractimpl]
impl VerifierDouble {
    pub fn answer(e: Env, answer: Answer) {
        e.storage()
            .instance()
            .set(&symbol_short!("answer"), &answer);
    }

    pub fn accepted(e: Env) -> Vec<Address> {
        e.storage()
            .instance()
            .get(&symbol_short!("accepted"))
            .unwrap_or(Vec::new(&e))
    }
}

#[contractimpl]
impl strata_bindings::ClaimsCheck for VerifierDouble {
    fn check_claims(e: Env, identity: Address) {
        let answer: Answer = e
            .storage()
            .instance()
            .get(&symbol_short!("answer"))
            .unwrap_or(Answer::ClaimOnKyc);
        let accepts = match answer {
            Answer::ClaimOnKyc => !IdentityClaimsClient::new(&e, &identity)
                .get_claim_ids_by_topic(&KYC)
                .is_empty(),
            Answer::Everyone => true,
            Answer::Nobody => false,
        };
        if !accepts {
            panic_with_error!(&e, RWAError::IdentityVerificationFailed);
        }
        let mut accepted = Self::accepted(e.clone());
        accepted.push_back(identity);
        e.storage()
            .instance()
            .set(&symbol_short!("accepted"), &accepted);
    }
}

fn running() -> Clock {
    Clock {
        delay: MIN_DELAY,
        exit_window: 0,
        paused_secs: 0,
        paused: false,
        winding_down: false,
    }
}

fn instance_ttl(e: &Env, id: &Address) -> u32 {
    e.as_contract(id, || e.storage().instance().get_ttl())
}

fn age(e: &Env) {
    e.ledger()
        .with_mut(|l| l.sequence_number += TWO_DAYS_IN_LEDGERS);
}

fn to_vec(bytes: &Bytes) -> std::vec::Vec<u8> {
    bytes.iter().collect()
}

/// Deploys an instance of the code uploaded at `wasm`, as a provider would.
fn deploy(e: &Env, wasm: &BytesN<32>, owner: &Address) -> Address {
    e.deployer()
        .with_address(Address::generate(e), BytesN::from_array(e, &[0; 32]))
        .deploy_contract(ContractExecutable::Wasm(wasm.clone()), (owner.clone(),))
}

struct Fixture<'a> {
    e: Env,
    registry: IdentityRegistryClient<'a>,
    clock: ClockStubClient<'a>,
    verifier: VerifierDoubleClient<'a>,
    admin: Address,
    compliance: Address,
    identity_wasm: BytesN<32>,
    issuer: Address,
    key: SigningKey,
}

impl Fixture<'_> {
    /// A claim on `KYC` the trusted issuer's key signed for `identity`.
    fn claim_for(&self, identity: &Address) -> SignedClaim {
        let now = self.e.ledger().timestamp();
        let data = encode_claim_data_expiration(
            &self.e,
            now,
            now + YEAR,
            &Bytes::from_slice(&self.e, b"kyc"),
        );
        let message = self.e.as_contract(&self.issuer, || {
            Ed25519Verifier::build_message(&self.e, identity, KYC, &data)
        });
        let signature = self.key.sign(&to_vec(&message));
        let mut sig_data = std::vec::Vec::new();
        sig_data.extend_from_slice(self.key.verifying_key().as_bytes());
        sig_data.extend_from_slice(&signature.to_bytes());
        SignedClaim {
            topic: KYC,
            scheme: ED25519_SCHEME,
            issuer: self.issuer.clone(),
            signature: Bytes::from_slice(&self.e, &sig_data),
            data,
            uri: String::from_str(&self.e, ""),
        }
    }

    /// The claims `account` brings to `onboard`: one valid claim on `KYC`.
    fn claims_of(&self, account: &Address) -> Vec<SignedClaim> {
        let identity = self.registry.identity_address(account);
        vec![&self.e, self.claim_for(&identity)]
    }

    /// A wallet that onboarded with a valid claim, and its identity.
    fn onboarded(&self) -> (Address, Address) {
        let account = Address::generate(&self.e);
        let identity = self.registry.onboard(&account, &self.claims_of(&account));
        (account, identity)
    }

    /// An identity `owner` deployed and filled with a valid claim itself.
    fn own_identity(&self, owner: &Address) -> Address {
        let identity = deploy(&self.e, &self.identity_wasm, owner);
        let claim = self.claim_for(&identity);
        IdentityClaimsClient::new(&self.e, &identity).add_claim(
            &claim.topic,
            &claim.scheme,
            &claim.issuer,
            &claim.signature,
            &claim.data,
            &claim.uri,
        );
        identity
    }

    fn propose(&self, change: &RegistryChange) -> u32 {
        self.registry.propose_change(change)
    }

    fn land(&self, change: &RegistryChange) {
        let id = self.propose(change);
        self.e.ledger().with_mut(|l| l.timestamp += MIN_DELAY);
        self.registry.apply_change(&id);
    }

    fn wind_down(&self) {
        let mut winding = running();
        winding.winding_down = true;
        self.clock.set(&winding);
    }

    /// Lets the instance decay past its extend threshold, then checks the call
    /// extends it back to the full TTL.
    fn restores_the_instance(&self, call: impl FnOnce()) {
        age(&self.e);
        assert!(instance_ttl(&self.e, &self.registry.address) < INSTANCE_EXTEND_AMOUNT);
        call();
        assert_eq!(
            instance_ttl(&self.e, &self.registry.address),
            INSTANCE_EXTEND_AMOUNT
        );
    }
}

/// A trusted kit issuer for `KYC` with one allowed key, on a topics contract
/// of its own.
fn issuer_stack(e: &Env, governance: &Address) -> (Address, SigningKey) {
    let issuer_wasm = e.upload(ClaimIssuerContract);
    let topics = ClaimTopicsClient::new(
        e,
        &e.register(ClaimTopics, (governance.clone(), issuer_wasm.clone())),
    );
    topics.add_claim_topic(&KYC, governance);
    let issuer = deploy(e, &issuer_wasm, &Address::generate(e));
    topics.add_trusted_issuer(&issuer, &vec![e, KYC], governance);
    let key = SigningKey::from_bytes(&[7u8; 32]);
    ClaimIssuerContractClient::new(e, &issuer).allow_key(
        &Bytes::from_slice(e, key.verifying_key().as_bytes()),
        &topics.address,
        &KYC,
    );
    (issuer, key)
}

/// A registry in setup, bound to neither its vault nor its verifier.
fn unbound<'a>() -> Fixture<'a> {
    let e = Env::default();
    e.mock_all_auths();
    e.ledger().set_timestamp(NOW);
    let admin = Address::generate(&e);
    let compliance = Address::generate(&e);
    let identity_wasm = e.upload(InvestorIdentity);
    let registry = IdentityRegistryClient::new(
        &e,
        &e.register(
            IdentityRegistry,
            (admin.clone(), compliance.clone(), identity_wasm.clone()),
        ),
    );
    let clock = ClockStubClient::new(&e, &e.register(ClockStub, ()));
    clock.set(&running());
    let verifier = VerifierDoubleClient::new(&e, &e.register(VerifierDouble, ()));
    let (issuer, key) = issuer_stack(&e, &admin);
    Fixture {
        e,
        registry,
        clock,
        verifier,
        admin,
        compliance,
        identity_wasm,
        issuer,
        key,
    }
}

/// A registry bound to its vault and its verifier, with setup still open.
fn bound<'a>() -> Fixture<'a> {
    let f = unbound();
    f.registry.bind_vault(&f.clock.address);
    f.registry.bind_verifier(&f.verifier.address);
    f
}

fn finished<'a>() -> Fixture<'a> {
    let f = bound();
    f.registry.finish_setup();
    f
}

fn refused<T: core::fmt::Debug + PartialEq, E: core::fmt::Debug + PartialEq>(
    result: Result<Result<T, E>, Result<soroban_sdk::Error, soroban_sdk::InvokeError>>,
    expected: impl Into<soroban_sdk::Error>,
) {
    assert_eq!(result, Err(Ok(expected.into())));
}

/// Asserts a call failed for lack of a valid signature, or because the callee
/// answers no interface the host can invoke: either way, the host's own
/// refusal of the invocation, not one of the contract's named errors.
fn missing_auth<T: core::fmt::Debug + PartialEq, E: core::fmt::Debug + PartialEq>(
    result: Result<Result<T, E>, Result<soroban_sdk::Error, soroban_sdk::InvokeError>>,
) {
    use soroban_sdk::xdr::{ScErrorCode, ScErrorType};
    assert_eq!(
        result,
        Err(Ok(soroban_sdk::Error::from_type_and_code(
            ScErrorType::Context,
            ScErrorCode::InvalidAction
        )))
    );
}

#[test]
fn construction_writes_the_instance_with_the_full_ttl() {
    let f = unbound();

    assert_eq!(
        instance_ttl(&f.e, &f.registry.address),
        INSTANCE_EXTEND_AMOUNT
    );
    assert_eq!(f.registry.identity_wasm(), f.identity_wasm);
    assert_eq!(f.registry.compliance(), f.compliance);
    assert_eq!(f.registry.get_admin(), Some(f.admin.clone()));
}
