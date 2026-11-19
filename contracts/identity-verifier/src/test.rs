extern crate std;

mod changes;
mod faults;
mod guards;
mod protocol;
mod readiness;
mod ttl;
mod verification;

use claim_issuer::{ClaimIssuerContract, ClaimIssuerContractClient, ED25519_SCHEME};
use claim_topics::{ClaimTopics, ClaimTopicsClient};
use ed25519_dalek::{Signer, SigningKey};
use identity_registry::{IdentityRegistry, IdentityRegistryClient, SignedClaim};
use investor_identity::InvestorIdentity;
use soroban_sdk::{
    contract, contractimpl, contracttype, panic_with_error, symbol_short,
    testutils::{storage::Instance as _, Address as _, Ledger as _},
    vec,
    xdr::{ContractEventBody, ScAddress, ScVal},
    Address, Bytes, BytesN, ConstructorArgs, ContractExecutable, Env, Map, String, Vec,
};
use stellar_tokens::rwa::{
    identity_verification::{
        claim_issuer::{
            encode_claim_data_expiration, ClaimIssuer, Ed25519Verifier, SignatureVerifier,
        },
        identity_claims::{generate_claim_id, Claim, ClaimsError, IdentityClaimsClient},
        identity_registry_storage::IRSError,
    },
    IdentityVerifierClient as TokenSideClient,
};
use strata_bindings::{ClaimsCheckClient, VerifierSetupClient};
use strata_storage::INSTANCE_EXTEND_AMOUNT;
use strata_timelock::{Clock, MIN_DELAY};

use crate::{IdentityVerifier, IdentityVerifierClient, VerifierChange, VerifierError};

const KYC: u32 = 1;
const AML: u32 = 2;
const NOW: u64 = 10_000;
const YEAR: u64 = 365 * 86_400;
const TWO_DAYS_IN_LEDGERS: u32 = 2 * 17_280;

type CallResult<T> = Result<
    Result<T, soroban_sdk::ConversionError>,
    Result<soroban_sdk::Error, soroban_sdk::InvokeError>,
>;

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

/// How a double answers the call a test points at it.
#[contracttype]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum Behaviour {
    /// Answers as the real contract would.
    Answers,
    /// Traps, as broken code would.
    Traps,
    /// Fails with this contract error code.
    Fails(u32),
}

fn set_behaviour(e: &Env, behaviour: Behaviour) {
    e.storage()
        .instance()
        .set(&symbol_short!("behaves"), &behaviour);
}

fn behave(e: &Env) {
    let behaviour = e
        .storage()
        .instance()
        .get(&symbol_short!("behaves"))
        .unwrap_or(Behaviour::Answers);
    match behaviour {
        Behaviour::Answers => {}
        Behaviour::Traps => panic!("the double traps"),
        Behaviour::Fails(code) => {
            panic_with_error!(e, soroban_sdk::Error::from_contract_error(code))
        }
    }
}

/// Plays the registry: links the wallets a test names.
#[contract]
struct RegistryDouble;

#[contractimpl]
impl RegistryDouble {
    pub fn behave_as(e: Env, behaviour: Behaviour) {
        set_behaviour(&e, behaviour);
    }

    pub fn link(e: Env, account: Address, identity: Address) {
        e.storage().persistent().set(&account, &identity);
    }

    pub fn stored_identity(e: Env, account: Address) -> Address {
        behave(&e);
        e.storage()
            .persistent()
            .get(&account)
            .unwrap_or_else(|| panic_with_error!(&e, IRSError::IdentityNotFound))
    }
}

/// Plays the topics contract: requires the topics and issuers a test names.
#[contract]
struct TopicsDouble;

#[contractimpl]
impl TopicsDouble {
    pub fn behave_as(e: Env, behaviour: Behaviour) {
        set_behaviour(&e, behaviour);
    }

    pub fn require(e: Env, required: Map<u32, Vec<Address>>) {
        e.storage()
            .instance()
            .set(&symbol_short!("required"), &required);
    }

    pub fn get_claim_topics_and_issuers(e: Env) -> Map<u32, Vec<Address>> {
        behave(&e);
        e.storage()
            .instance()
            .get(&symbol_short!("required"))
            .unwrap_or(Map::new(&e))
    }
}

/// Plays an identity: serves whatever claims a test stores, under any id.
#[contract]
struct IdentityDouble;

#[contractimpl]
impl IdentityDouble {
    pub fn behave_as(e: Env, behaviour: Behaviour) {
        set_behaviour(&e, behaviour);
    }

    pub fn serve(e: Env, claim_id: BytesN<32>, claim: Claim) {
        e.storage().persistent().set(&claim_id, &claim);
    }

    pub fn get_claim(e: Env, claim_id: BytesN<32>) -> Claim {
        behave(&e);
        e.storage()
            .persistent()
            .get(&claim_id)
            .unwrap_or_else(|| panic_with_error!(&e, ClaimsError::ClaimNotFound))
    }
}

/// Plays an issuer whose code is not the kit's.
#[contract]
struct IssuerDouble;

#[contractimpl]
impl IssuerDouble {
    pub fn behave_as(e: Env, behaviour: Behaviour) {
        set_behaviour(&e, behaviour);
    }
}

#[contractimpl]
impl ClaimIssuer for IssuerDouble {
    fn is_claim_valid(
        e: &Env,
        _identity: Address,
        _claim_topic: u32,
        _scheme: u32,
        _sig_data: Bytes,
        _claim_data: Bytes,
    ) {
        behave(e);
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

/// Deploys an instance of the code uploaded at `wasm`.
fn deploy<A: ConstructorArgs>(e: &Env, wasm: &BytesN<32>, args: A) -> Address {
    e.deployer()
        .with_address(Address::generate(e), BytesN::from_array(e, &[0; 32]))
        .deploy_contract(ContractExecutable::Wasm(wasm.clone()), args)
}

/// A kit issuer and the one key it allows for its topics.
struct Provider {
    issuer: Address,
    key: SigningKey,
}

impl Provider {
    /// A claim on `topic`, created now and valid until `valid_until`, signed
    /// for `identity`.
    fn claim(&self, e: &Env, identity: &Address, topic: u32, valid_until: u64) -> SignedClaim {
        let created_at = e.ledger().timestamp();
        self.claim_dated(e, identity, topic, created_at, valid_until)
    }

    fn claim_dated(
        &self,
        e: &Env,
        identity: &Address,
        topic: u32,
        created_at: u64,
        valid_until: u64,
    ) -> SignedClaim {
        let data =
            encode_claim_data_expiration(e, created_at, valid_until, &Bytes::from_slice(e, b"ok"));
        let message = e.as_contract(&self.issuer, || {
            Ed25519Verifier::build_message(e, identity, topic, &data)
        });
        let signature = self
            .key
            .sign(&message.iter().collect::<std::vec::Vec<u8>>());
        let mut sig_data = std::vec::Vec::new();
        sig_data.extend_from_slice(self.key.verifying_key().as_bytes());
        sig_data.extend_from_slice(&signature.to_bytes());
        SignedClaim {
            topic,
            scheme: ED25519_SCHEME,
            issuer: self.issuer.clone(),
            signature: Bytes::from_slice(e, &sig_data),
            data,
            uri: String::from_str(e, ""),
        }
    }
}

/// Deploys a kit issuer, trusts it on `topics` for `claim_topics`, and allows
/// one key for each of them.
fn trusted_provider(
    e: &Env,
    topics: &ClaimTopicsClient,
    admin: &Address,
    issuer_wasm: &BytesN<32>,
    claim_topics: &[u32],
    seed: u8,
) -> Provider {
    let issuer = deploy(e, issuer_wasm, (Address::generate(e),));
    topics.add_trusted_issuer(&issuer, &Vec::from_slice(e, claim_topics), admin);
    let key = SigningKey::from_bytes(&[seed; 32]);
    let issuer_client = ClaimIssuerContractClient::new(e, &issuer);
    for topic in claim_topics {
        issuer_client.allow_key(
            &Bytes::from_slice(e, key.verifying_key().as_bytes()),
            &topics.address,
            topic,
        );
    }
    Provider { issuer, key }
}

/// The production stack: a topics contract requiring `KYC` from one kit
/// issuer, a registry asking this verifier, and the verifier.
struct Fixture<'a> {
    e: Env,
    verifier: IdentityVerifierClient<'a>,
    registry: IdentityRegistryClient<'a>,
    topics: ClaimTopicsClient<'a>,
    clock: ClockStubClient<'a>,
    admin: Address,
    issuer_wasm: BytesN<32>,
    kyc: Provider,
}

impl Fixture<'_> {
    /// A second kit issuer, trusted for `AML`, which becomes required.
    fn require_aml(&self) -> Provider {
        self.topics.add_claim_topic(&AML, &self.admin);
        trusted_provider(
            &self.e,
            &self.topics,
            &self.admin,
            &self.issuer_wasm,
            &[AML],
            9,
        )
    }

    /// A wallet that onboarded through the registry with `claims`, and its
    /// identity.
    fn onboard_with(&self, claims: impl Fn(&Address) -> Vec<SignedClaim>) -> (Address, Address) {
        let account = Address::generate(&self.e);
        let identity = self.registry.identity_address(&account);
        self.registry.onboard(&account, &claims(&identity));
        (account, identity)
    }

    /// A wallet that onboarded with a `KYC` claim valid for a year.
    fn onboarded(&self) -> (Address, Address) {
        self.onboard_with(|identity| {
            vec![&self.e, self.kyc.claim(&self.e, identity, KYC, NOW + YEAR)]
        })
    }

    fn stored_claim(&self, identity: &Address, issuer: &Address, topic: u32) -> Claim {
        IdentityClaimsClient::new(&self.e, identity)
            .get_claim(&generate_claim_id(&self.e, issuer, topic))
    }

    fn verify(&self, account: &Address) -> CallResult<()> {
        TokenSideClient::new(&self.e, &self.verifier.address).try_verify_identity(account)
    }

    fn check_claims(&self, identity: &Address) -> CallResult<()> {
        ClaimsCheckClient::new(&self.e, &self.verifier.address).try_check_claims(identity)
    }

    fn ready(&self) -> bool {
        VerifierSetupClient::new(&self.e, &self.verifier.address)
            .ready_for(&self.clock.address, &self.admin)
    }

    fn propose(&self, change: &VerifierChange) -> u32 {
        self.verifier.propose_change(change)
    }

    fn land(&self, change: &VerifierChange) {
        let id = self.propose(change);
        self.e.ledger().with_mut(|l| l.timestamp += MIN_DELAY);
        self.verifier.apply_change(&id);
    }

    fn wind_down(&self) {
        let mut winding = running();
        winding.winding_down = true;
        self.clock.set(&winding);
    }

    /// Closes the topics contract's and the registry's setups on the vault.
    fn close_the_stack(&self) {
        self.topics.bind_vault(&self.clock.address);
        self.topics.finish_setup();
        self.registry.bind_vault(&self.clock.address);
        self.registry.finish_setup();
    }

    /// Lets the instance decay past its extend threshold, then checks the call
    /// extends it back to the full TTL.
    fn restores_the_instance(&self, call: impl FnOnce()) {
        age(&self.e);
        assert!(instance_ttl(&self.e, &self.verifier.address) < INSTANCE_EXTEND_AMOUNT);
        call();
        assert_eq!(
            instance_ttl(&self.e, &self.verifier.address),
            INSTANCE_EXTEND_AMOUNT
        );
    }
}

/// The stack with every setup open, and the verifier bound to no vault.
fn unbound<'a>() -> Fixture<'a> {
    let e = Env::default();
    e.mock_all_auths();
    e.ledger().set_timestamp(NOW);
    let admin = Address::generate(&e);
    let clock = ClockStubClient::new(&e, &e.register(ClockStub, ()));
    clock.set(&running());
    let issuer_wasm = e.upload(ClaimIssuerContract);
    let topics = ClaimTopicsClient::new(
        &e,
        &e.register(ClaimTopics, (admin.clone(), issuer_wasm.clone())),
    );
    topics.add_claim_topic(&KYC, &admin);
    let kyc = trusted_provider(&e, &topics, &admin, &issuer_wasm, &[KYC], 7);
    let registry_wasm = e.upload(IdentityRegistry);
    let registry = IdentityRegistryClient::new(
        &e,
        &deploy(
            &e,
            &registry_wasm,
            (
                admin.clone(),
                Address::generate(&e),
                e.upload(InvestorIdentity),
            ),
        ),
    );
    let verifier = IdentityVerifierClient::new(
        &e,
        &e.register(
            IdentityVerifier,
            (
                admin.clone(),
                registry.address.clone(),
                topics.address.clone(),
            ),
        ),
    );
    registry.bind_verifier(&verifier.address);
    Fixture {
        e,
        verifier,
        registry,
        topics,
        clock,
        admin,
        issuer_wasm,
        kyc,
    }
}

/// The verifier bound to its vault, with every setup still open.
fn bound<'a>() -> Fixture<'a> {
    let f = unbound();
    f.verifier.bind_vault(&f.clock.address);
    f
}

fn finished<'a>() -> Fixture<'a> {
    let f = bound();
    f.verifier.finish_setup();
    f
}

/// The verifier over doubles of the registry, the topics contract and one
/// identity, which the registry links to `account`.
struct Doubles<'a> {
    e: Env,
    verifier: IdentityVerifierClient<'a>,
    registry: RegistryDoubleClient<'a>,
    topics: TopicsDoubleClient<'a>,
    identity: IdentityDoubleClient<'a>,
    clock: ClockStubClient<'a>,
    account: Address,
    kit: Provider,
}

impl Doubles<'_> {
    /// Another verifier, reading `registry` and `topics`.
    fn verifier_over(&self, registry: &Address, topics: &Address) -> Address {
        self.e.register(
            IdentityVerifier,
            (Address::generate(&self.e), registry.clone(), topics.clone()),
        )
    }

    fn issuer(&self, behaviour: Behaviour) -> Address {
        let issuer = IssuerDoubleClient::new(&self.e, &self.e.register(IssuerDouble, ()));
        issuer.behave_as(&behaviour);
        issuer.address
    }

    fn require(&self, required: &[(u32, &[&Address])]) {
        let mut map = Map::new(&self.e);
        for (topic, issuers) in required {
            let mut list = Vec::new(&self.e);
            for issuer in issuers.iter() {
                list.push_back((*issuer).clone());
            }
            map.set(*topic, list);
        }
        self.topics.require(&map);
    }

    /// Serves `claim` at the id OpenZeppelin gives its issuer and topic.
    fn serve(&self, claim: &Claim) {
        self.identity.serve(
            &generate_claim_id(&self.e, &claim.issuer, claim.topic),
            claim,
        );
    }

    /// A claim on `topic` from an issuer double, with a signature nobody
    /// checks.
    fn unsigned_claim(&self, issuer: &Address, topic: u32) -> Claim {
        let data = encode_claim_data_expiration(
            &self.e,
            NOW,
            NOW + YEAR,
            &Bytes::from_slice(&self.e, b"ok"),
        );
        Claim {
            topic,
            scheme: ED25519_SCHEME,
            issuer: issuer.clone(),
            signature: Bytes::from_slice(&self.e, &[0; 96]),
            data,
            uri: String::from_str(&self.e, ""),
        }
    }

    /// A claim the kit issuer's key signed for `identity`.
    fn kit_claim(
        &self,
        identity: &Address,
        topic: u32,
        created_at: u64,
        valid_until: u64,
    ) -> Claim {
        let signed = self
            .kit
            .claim_dated(&self.e, identity, topic, created_at, valid_until);
        Claim {
            topic: signed.topic,
            scheme: signed.scheme,
            issuer: signed.issuer,
            signature: signed.signature,
            data: signed.data,
            uri: signed.uri,
        }
    }

    fn verify(&self) -> CallResult<()> {
        TokenSideClient::new(&self.e, &self.verifier.address).try_verify_identity(&self.account)
    }

    fn check_claims(&self) -> CallResult<()> {
        ClaimsCheckClient::new(&self.e, &self.verifier.address)
            .try_check_claims(&self.identity.address)
    }
}

fn doubles<'a>() -> Doubles<'a> {
    let e = Env::default();
    e.mock_all_auths();
    e.ledger().set_timestamp(NOW);
    let admin = Address::generate(&e);
    let clock = ClockStubClient::new(&e, &e.register(ClockStub, ()));
    clock.set(&running());
    let registry = RegistryDoubleClient::new(&e, &e.register(RegistryDouble, ()));
    let topics = TopicsDoubleClient::new(&e, &e.register(TopicsDouble, ()));
    let identity = IdentityDoubleClient::new(&e, &e.register(IdentityDouble, ()));
    let account = Address::generate(&e);
    registry.link(&account, &identity.address);
    let verifier = IdentityVerifierClient::new(
        &e,
        &e.register(
            IdentityVerifier,
            (
                admin.clone(),
                registry.address.clone(),
                topics.address.clone(),
            ),
        ),
    );
    verifier.bind_vault(&clock.address);
    let issuer_wasm = e.upload(ClaimIssuerContract);
    let keys = ClaimTopicsClient::new(
        &e,
        &e.register(ClaimTopics, (admin.clone(), issuer_wasm.clone())),
    );
    keys.add_claim_topic(&KYC, &admin);
    keys.add_claim_topic(&AML, &admin);
    let kit = trusted_provider(&e, &keys, &admin, &issuer_wasm, &[KYC, AML], 7);
    Doubles {
        e,
        verifier,
        registry,
        topics,
        identity,
        clock,
        account,
        kit,
    }
}

fn verified(result: CallResult<()>) {
    assert_eq!(result, Ok(Ok(())));
}

fn refused<T: core::fmt::Debug + PartialEq, E: core::fmt::Debug + PartialEq>(
    result: Result<Result<T, E>, Result<soroban_sdk::Error, soroban_sdk::InvokeError>>,
    expected: impl Into<soroban_sdk::Error>,
) {
    assert_eq!(result, Err(Ok(expected.into())));
}

fn unavailable(result: CallResult<()>) {
    refused(result, VerifierError::Unavailable);
}

fn not_verified(result: CallResult<()>) {
    refused(
        result,
        stellar_tokens::rwa::RWAError::IdentityVerificationFailed,
    );
}

/// Asserts a call failed for lack of a valid signature, or because the callee
/// answers no interface the host can invoke: either way, the host's own
/// refusal of the invocation, not one of the contract's named errors.
fn missing_auth<T: core::fmt::Debug + PartialEq, E: core::fmt::Debug + PartialEq>(
    result: Result<Result<T, E>, Result<soroban_sdk::Error, soroban_sdk::InvokeError>>,
) {
    assert_eq!(result, Err(Ok(host_error())));
}

/// An account, not a contract: a call to it fails the caller too, beyond
/// what `try_` catches.
fn account_address(e: &Env) -> Address {
    Address::from_str(
        e,
        "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
    )
}

/// The one error the host reports for any failure of a called contract that
/// is not a contract error.
fn host_error() -> soroban_sdk::Error {
    use soroban_sdk::xdr::{ScErrorCode, ScErrorType};
    soroban_sdk::Error::from_type_and_code(ScErrorType::Context, ScErrorCode::InvalidAction)
}

/// The contract and function of every call the last top-level call made,
/// itself included.
fn calls(e: &Env) -> std::vec::Vec<(ScVal, ScVal)> {
    e.host()
        .get_diagnostic_events()
        .unwrap()
        .0
        .into_iter()
        .filter_map(|event| {
            let ContractEventBody::V0(body) = event.event.body;
            let topics = body.topics.to_vec();
            (topics.first() == Some(&ScVal::Symbol("fn_call".try_into().unwrap())))
                .then(|| (topics[1].clone(), topics[2].clone()))
        })
        .collect()
}

/// How a call's diagnostic event names the contract at `address`.
fn contract_id(address: &Address) -> ScVal {
    let ScAddress::Contract(id) = ScAddress::from(address) else {
        panic!("not a contract");
    };
    ScVal::Bytes(id.0 .0.to_vec().try_into().unwrap())
}

fn symbol(name: &str) -> ScVal {
    ScVal::Symbol(name.try_into().unwrap())
}

#[test]
fn construction_writes_the_instance_with_the_full_ttl() {
    let f = unbound();

    assert_eq!(
        instance_ttl(&f.e, &f.verifier.address),
        INSTANCE_EXTEND_AMOUNT
    );
    assert_eq!(f.verifier.get_admin(), Some(f.admin.clone()));
    assert_eq!(f.verifier.identity_registry(), f.registry.address);
    assert_eq!(f.verifier.claim_topics_and_issuers(), f.topics.address);
}

#[test]
fn recovery_is_not_offered() {
    let f = finished();
    let (account, _) = f.onboarded();

    assert_eq!(
        TokenSideClient::new(&f.e, &f.verifier.address).recovery_target(&account),
        None
    );
}
