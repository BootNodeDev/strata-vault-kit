//! The vault over the kit's production identity stack: a topics contract
//! requiring `KYC` from one kit issuer, a registry that onboards investors,
//! and the kit's verifier on the share token.

use claim_issuer::{ClaimIssuerContract, ClaimIssuerContractClient, ED25519_SCHEME};
use claim_topics::{ClaimTopics, ClaimTopicsClient};
use ed25519_dalek::{Signer, SigningKey};
use identity_registry::{IdentityRegistry, IdentityRegistryClient, SignedClaim};
use identity_verifier::{
    IdentityVerifier as KitVerifier, IdentityVerifierClient as KitVerifierClient, VerifierError,
};
use investor_identity::InvestorIdentity;
use soroban_sdk::{
    contract, contractimpl, testutils::Events as _, vec, Bytes, ConstructorArgs,
    ContractExecutable, Event as _,
};
use stellar_tokens::rwa::{
    identity_verification::{
        claim_issuer::{encode_claim_data_expiration, Ed25519Verifier, SignatureVerifier},
        identity_registry_storage::IRSError,
        IdentityVerifierClient as TokenSideVerifierClient,
    },
    RWAError,
};

use super::wind_down::wind_down_now;
use super::*;
use crate::{DepositConvertedToExit, EpochReconciled, EpochSharesReconciled};

const KYC: u32 = 1;
const HOUR: u64 = 3_600;
const YEAR: u64 = 365 * 86_400;

type CallResult = Result<
    Result<(), soroban_sdk::ConversionError>,
    Result<soroban_sdk::Error, soroban_sdk::InvokeError>,
>;

/// Code that traps on every claim check. Uploaded over the kit issuer's Wasm
/// hash, it breaks the issuer while the issuer keeps its address, its storage
/// and its place on the topics contract.
#[contract]
struct TrappingIssuer;

#[contractimpl]
impl TrappingIssuer {
    pub fn is_claim_valid(
        _e: Env,
        _identity: Address,
        _claim_topic: u32,
        _scheme: u32,
        _sig_data: Bytes,
        _claim_data: Bytes,
    ) {
        panic!("the issuer traps");
    }
}

struct Stack<'a> {
    f: Fixture<'a>,
    verifier: KitVerifierClient<'a>,
    registry: IdentityRegistryClient<'a>,
    issuer: Address,
    issuer_wasm: BytesN<32>,
    key: SigningKey,
}

impl Stack<'_> {
    /// A `KYC` claim created now, valid until `valid_until`, signed by the
    /// kit issuer for `identity`.
    fn claim(&self, identity: &Address, valid_until: u64) -> SignedClaim {
        let e = &self.f.e;
        let data = encode_claim_data_expiration(
            e,
            e.ledger().timestamp(),
            valid_until,
            &Bytes::from_slice(e, b"ok"),
        );
        let message = e.as_contract(&self.issuer, || {
            Ed25519Verifier::build_message(e, identity, KYC, &data)
        });
        let signature = self
            .key
            .sign(&message.iter().collect::<std::vec::Vec<u8>>());
        let mut sig_data = std::vec::Vec::new();
        sig_data.extend_from_slice(self.key.verifying_key().as_bytes());
        sig_data.extend_from_slice(&signature.to_bytes());
        SignedClaim {
            topic: KYC,
            scheme: ED25519_SCHEME,
            issuer: self.issuer.clone(),
            signature: Bytes::from_slice(e, &sig_data),
            data,
            uri: String::from_str(e, ""),
        }
    }

    /// A wallet holding `funded` of the asset that onboarded through the
    /// registry with a `KYC` claim valid until `valid_until`.
    fn onboarded_until(&self, funded: i128, valid_until: u64) -> Address {
        let who = self.f.unverified_investor(funded);
        let identity = self.registry.identity_address(&who);
        self.registry
            .onboard(&who, &vec![&self.f.e, self.claim(&identity, valid_until)]);
        who
    }

    fn onboarded(&self, funded: i128) -> Address {
        self.onboarded_until(funded, self.f.e.ledger().timestamp() + YEAR)
    }

    /// A 400 deposit priced at 2.0 for 200 shares, not yet claimed.
    fn priced_deposit(&self) -> (Address, u64) {
        let investor = self.onboarded(1_000);
        let epoch = self.f.vault.request_deposit(&investor, &400);
        self.f.fulfill_epoch(price(2));
        (investor, epoch)
    }

    fn holder(&self, shares: i128) -> Address {
        let who = self.onboarded(shares * 2);
        let epoch = self.f.vault.request_deposit(&who, &(shares * 2));
        self.f.fulfill_epoch(price(2));
        self.f.vault.claim_deposit(&who, &epoch);
        who
    }

    fn verify(&self, account: &Address) -> CallResult {
        TokenSideVerifierClient::new(&self.f.e, &self.verifier.address).try_verify_identity(account)
    }

    /// Every instance of the kit issuer's code traps from now on.
    fn break_issuer(&self) {
        self.f.e.upload_at(self.issuer_wasm.clone(), TrappingIssuer);
    }

    fn fix_issuer(&self) {
        self.f
            .e
            .upload_at(self.issuer_wasm.clone(), ClaimIssuerContract);
    }
}

/// Deploys an instance of the code uploaded at `wasm`, as a provider would.
fn deploy<A: ConstructorArgs>(e: &Env, wasm: &BytesN<32>, args: A) -> Address {
    e.deployer()
        .with_address(Address::generate(e), BytesN::from_array(e, &[0; 32]))
        .deploy_contract(ContractExecutable::Wasm(wasm.clone()), args)
}

/// The vault in setup over the stack, wired apart from `miswire`. Every stack
/// contract is bound to the vault; the topics contract and the registry have
/// closed their setups, the verifier has not.
fn stack_in_setup<'a>(miswire: Miswire) -> Stack<'a> {
    let f = build(
        open_feed(),
        |e, (name, symbol, admin, authority, compliance, _)| {
            let topics = e.register(ClaimTopics, (admin.clone(), e.upload(ClaimIssuerContract)));
            let registry = e.register(
                IdentityRegistry,
                (admin.clone(), authority.clone(), e.upload(InvestorIdentity)),
            );
            let verifier = e.register(KitVerifier, (admin.clone(), registry, topics));
            e.register(
                ShareToken,
                (name, symbol, admin, authority, compliance, verifier),
            )
        },
        miswire,
        false,
    );
    let e = &f.e;
    let verifier = KitVerifierClient::new(e, &f.share.identity_verifier());
    let registry = IdentityRegistryClient::new(e, &verifier.identity_registry());
    let topics = ClaimTopicsClient::new(e, &verifier.claim_topics_and_issuers());

    topics.add_claim_topic(&KYC, &f.admin);
    let issuer_wasm = topics.issuer_wasm();
    let issuer = deploy(e, &issuer_wasm, (Address::generate(e),));
    topics.add_trusted_issuer(&issuer, &vec![e, KYC], &f.admin);
    let key = SigningKey::from_bytes(&[7; 32]);
    ClaimIssuerContractClient::new(e, &issuer).allow_key(
        &Bytes::from_slice(e, key.verifying_key().as_bytes()),
        &topics.address,
        &KYC,
    );
    registry.bind_verifier(&verifier.address);

    topics.bind_vault(&f.vault.address);
    topics.finish_setup();
    registry.bind_vault(&f.vault.address);
    registry.finish_setup();
    verifier.bind_vault(&f.vault.address);

    Stack {
        verifier,
        registry,
        issuer,
        issuer_wasm,
        key,
        f,
    }
}

/// A vault open for requests over a stack whose every setup has closed.
fn ready_stack<'a>() -> Stack<'a> {
    let s = stack_in_setup(Miswire::Nothing);
    s.verifier.finish_setup();
    finish_setup_and_report(&s.f);
    s
}

#[test]
fn the_vault_runs_on_the_production_stack() {
    let s = ready_stack();
    let health = s.f.vault.health();
    assert!(health.allowlisted);
    assert!(health.identity_ready);
    assert!(health.compliance_governed);

    let holder = s.holder(500);

    assert_eq!(s.f.shares(&holder), 500);
}

#[test]
fn a_verifier_fault_holds_a_priced_deposit_claim_open() {
    let s = ready_stack();
    let (investor, epoch) = s.priced_deposit();
    let open = s.f.vault.current_epoch();
    s.break_issuer();
    assert_eq!(
        s.verify(&investor),
        Err(Ok(VerifierError::Unavailable.into()))
    );

    refused(
        s.f.vault.try_claim_deposit(&investor, &epoch),
        VaultError::VerifierFailed,
    );

    assert!(
        !s.f.vault
            .get_deposit_request(&epoch, &investor)
            .unwrap()
            .claimed
    );
    assert_eq!(s.f.vault.pending_mint_shares(), 200);
    assert_eq!(s.f.shares(&investor), 0);
    assert_eq!(s.f.shares(&s.f.vault.address), 0);
    assert_eq!(s.f.vault.get_redeem_request(&open, &investor), None);

    s.fix_issuer();

    assert_eq!(s.f.vault.claim_deposit(&investor, &epoch), 200);
    assert_eq!(s.f.shares(&investor), 200);
}

/// A refund lets no one in, so a fault does not hold it, nor the epoch's
/// settlement behind it.
#[test]
fn a_verifier_fault_still_refunds_a_deposit_worth_no_shares() {
    let s = ready_stack();
    let investor = s.onboarded(10);
    let epoch = s.f.vault.request_deposit(&investor, &1);
    s.f.fulfill_epoch(price(2));
    s.break_issuer();
    assert_eq!(
        s.verify(&investor),
        Err(Ok(VerifierError::Unavailable.into()))
    );

    assert_eq!(s.f.vault.claim_deposit(&investor, &epoch), 0);

    assert_eq!(s.f.balance(&investor), 10);
    assert_eq!(s.f.vault.get_deposit_request(&epoch, &investor), None);
    assert!(s.f.vault.get_epoch_settlement(&epoch).unwrap().reconciled());
}

#[test]
fn a_verifier_fault_in_a_wind_down_surrenders_the_deposit() {
    let s = ready_stack();
    let (investor, epoch) = s.priced_deposit();
    wind_down_now(&s.f);
    s.break_issuer();
    assert_eq!(
        s.verify(&investor),
        Err(Ok(VerifierError::Unavailable.into()))
    );

    assert_eq!(s.f.vault.claim_deposit(&investor, &epoch), 0);

    let vault = &s.f.vault.address;
    assert_eq!(
        s.f.e.events().all().filter_by_contract(vault),
        [
            DepositConvertedToExit {
                holder: investor.clone(),
                epoch,
                into_epoch: 0,
                shares: 200,
            }
            .to_xdr(&s.f.e, vault),
            EpochSharesReconciled {
                epoch,
                share_dust: 0,
            }
            .to_xdr(&s.f.e, vault),
            EpochReconciled { epoch }.to_xdr(&s.f.e, vault),
        ]
    );
    assert_eq!(s.f.shares(&investor), 0);
    assert_eq!(s.f.vault.finalize_wind_down_round(), 400);
    assert_eq!(s.f.vault.claim_wind_down(&investor), 400);
    assert_eq!(s.f.balance(&investor), 1_000);
}

#[test]
fn a_kyc_refusal_still_converts_a_priced_deposit() {
    let s = ready_stack();
    let investor = s.onboarded_until(1_000, s.f.e.ledger().timestamp() + HOUR);
    let epoch = s.f.vault.request_deposit(&investor, &400);
    s.f.fulfill_epoch(price(2));
    s.f.advance(HOUR);
    assert_eq!(
        s.verify(&investor),
        Err(Ok(RWAError::IdentityVerificationFailed.into()))
    );
    let open = s.f.vault.current_epoch();

    assert_eq!(s.f.vault.claim_deposit(&investor, &epoch), 0);

    assert_eq!(s.f.shares(&investor), 0);
    assert_eq!(s.f.shares(&s.f.vault.address), 200);
    assert_eq!(
        s.f.vault
            .get_redeem_request(&open, &investor)
            .unwrap()
            .shares,
        200
    );
    let exit = s.f.fulfill_epoch(price(2));
    assert_eq!(s.f.vault.claim_redeem(&investor, &exit), 400);
    assert_eq!(s.f.balance(&investor), 1_000);
}

#[test]
fn a_redemption_request_works_whatever_the_vault_listing() {
    let s = ready_stack();
    let first = s.holder(500);
    let second = s.holder(500);
    let epoch = s.f.vault.current_epoch();
    let vault = &s.f.vault.address;
    assert_eq!(
        s.registry.try_stored_identity(vault),
        Err(Ok(IRSError::IdentityNotFound.into()))
    );

    assert_eq!(s.f.vault.request_redeem(&first, &200), epoch);

    s.registry.remove_identity(vault, &s.f.compliance);
    assert!(s.registry.is_vetoed(vault));

    assert_eq!(s.f.vault.request_redeem(&second, &200), epoch);
    assert_eq!(s.f.shares(vault), 400);
    assert_eq!(
        s.f.vault.get_epoch(&epoch).unwrap().total_shares_redeeming,
        400
    );
}

#[test]
fn a_verifier_fault_lets_no_one_in() {
    let s = ready_stack();
    let investor = s.onboarded(1_000);
    s.break_issuer();

    refused(
        s.f.vault.try_request_deposit(&investor, &400),
        VaultError::VerifierFailed,
    );
    assert_eq!(s.f.balance(&investor), 1_000);
    assert_eq!(s.f.vault.cancellable_escrow(), 0);

    s.fix_issuer();
    assert_eq!(
        s.f.vault.request_deposit(&investor, &400),
        s.f.vault.current_epoch()
    );
}

/// A fault forces no one out: the holder keeps the shares, and an exit
/// already asked for goes on to be paid in cash. Taking the escrow back as
/// shares waits for the verifier.
#[test]
fn a_verifier_fault_keeps_a_redemption_in_escrow_until_it_is_paid() {
    let s = ready_stack();
    let holder = s.holder(500);
    s.break_issuer();

    let epoch = s.f.vault.request_redeem(&holder, &200);
    refused(
        s.f.vault.try_cancel_redeem(&holder, &epoch),
        VaultError::VerifierFailed,
    );
    assert_eq!(s.f.shares(&holder), 300);
    assert_eq!(s.f.shares(&s.f.vault.address), 200);

    assert_eq!(s.f.fulfill_epoch(price(2)), epoch);
    assert_eq!(s.f.vault.claim_redeem(&holder, &epoch), 400);
    assert_eq!(s.f.balance(&holder), 400);
    assert_eq!(s.f.shares(&holder), 300);
}

#[test]
fn finish_setup_needs_the_identity_stack_ready() {
    let s = stack_in_setup(Miswire::Nothing);
    let health = s.f.vault.health();
    assert!(health.allowlisted);
    assert!(!health.identity_ready);

    refused(s.f.vault.try_finish_setup(), VaultError::SetupIncomplete);
    assert!(s.f.vault.setup_open());

    s.verifier.finish_setup();
    assert!(s.f.vault.health().identity_ready);
    s.f.vault.finish_setup();
    assert!(!s.f.vault.setup_open());
}

/// The vault asks the stack about its own governance, not about whoever
/// administers the verifier.
#[test]
fn the_identity_stack_must_answer_to_the_vaults_governance() {
    let s = stack_in_setup(Miswire::Nothing);
    let stranger = Address::generate(&s.f.e);
    s.verifier
        .transfer_admin_role(&stranger, &(s.f.e.ledger().sequence() + 100));
    s.verifier.accept_admin_transfer();
    s.verifier.finish_setup();

    assert!(!s.f.vault.health().identity_ready);
    refused(s.f.vault.try_finish_setup(), VaultError::SetupIncomplete);
}

#[test]
fn finish_setup_needs_compliance_governed_by_governance() {
    let s = stack_in_setup(Miswire::ComplianceNotGoverned);
    s.verifier.finish_setup();
    let health = s.f.vault.health();
    assert!(health.compliance_bound);
    assert!(health.identity_ready);
    assert!(!health.compliance_governed);

    refused(s.f.vault.try_finish_setup(), VaultError::SetupIncomplete);
    assert!(s.f.vault.setup_open());

    let rules = ComplianceClient::new(&s.f.e, &s.f.share.compliance());
    let id = rules.propose_change(&ComplianceChange::Admin(s.f.admin.clone()));
    s.f.advance(MIN_UPGRADE_DELAY);
    rules.apply_change(&id);
    rules.accept_admin_transfer();

    assert!(s.f.vault.health().compliance_governed);
    s.f.vault.finish_setup();
    assert!(!s.f.vault.setup_open());
}
