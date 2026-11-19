mod changes;
mod guards;
mod issuer_code;
mod ttl;

use claim_issuer::ClaimIssuerContract;
use soroban_sdk::{
    symbol_short,
    testutils::{storage::Instance as _, Address as _, Ledger as _},
    Address, BytesN, ContractExecutable, Env, Vec,
};
use strata_storage::INSTANCE_EXTEND_AMOUNT;
use strata_timelock::{Clock, MIN_DELAY};

use crate::{ClaimTopics, ClaimTopicsClient, TopicsChange};

const TWO_DAYS_IN_LEDGERS: u32 = 2 * 17_280;

/// Plays the vault: reports whatever clock a test sets, and counts the reads.
#[soroban_sdk::contract]
struct ClockStub;

#[soroban_sdk::contractimpl]
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

#[soroban_sdk::contractimpl(contracttrait)]
impl strata_timelock::ClockSource for ClockStub {
    fn timelock_clock(e: &Env) -> Clock {
        let reads = Self::reads(e.clone()) + 1;
        e.storage().instance().set(&symbol_short!("reads"), &reads);
        e.storage().instance().get(&symbol_short!("clock")).unwrap()
    }
}

/// Issuer code other than the kit's, deployed the same way.
#[soroban_sdk::contract]
struct ForeignIssuer;

#[soroban_sdk::contractimpl]
impl ForeignIssuer {
    pub fn __constructor(_e: Env, _owner: Address) {}
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

/// Deploys an instance of the code uploaded at `wasm`, as a provider would.
fn deploy(e: &Env, wasm: &BytesN<32>) -> Address {
    e.deployer()
        .with_address(Address::generate(e), BytesN::from_array(e, &[0; 32]))
        .deploy_contract(
            ContractExecutable::Wasm(wasm.clone()),
            (Address::generate(e),),
        )
}

fn topics(e: &Env, items: &[u32]) -> Vec<u32> {
    Vec::from_slice(e, items)
}

struct Fixture<'a> {
    e: Env,
    topics: ClaimTopicsClient<'a>,
    clock: ClockStubClient<'a>,
    admin: Address,
    issuer_wasm: BytesN<32>,
}

impl Fixture<'_> {
    /// A fresh instance of the kit issuer.
    fn kit_issuer(&self) -> Address {
        deploy(&self.e, &self.issuer_wasm)
    }

    fn propose(&self, change: &TopicsChange) -> u32 {
        self.topics.propose_change(change)
    }

    fn land(&self, change: &TopicsChange) {
        let id = self.propose(change);
        self.e.ledger().with_mut(|l| l.timestamp += MIN_DELAY);
        self.topics.apply_change(&id);
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
        assert!(instance_ttl(&self.e, &self.topics.address) < INSTANCE_EXTEND_AMOUNT);
        call();
        assert_eq!(
            instance_ttl(&self.e, &self.topics.address),
            INSTANCE_EXTEND_AMOUNT
        );
    }
}

/// A topics contract in setup, trusting the kit issuer's code, and a vault
/// clock it has not bound yet.
fn unbound<'a>() -> Fixture<'a> {
    let e = Env::default();
    e.mock_all_auths();
    e.ledger().set_timestamp(10_000);
    let admin = Address::generate(&e);
    let issuer_wasm = e.upload(ClaimIssuerContract);
    let topics = ClaimTopicsClient::new(
        &e,
        &e.register(ClaimTopics, (admin.clone(), issuer_wasm.clone())),
    );
    let clock = ClockStubClient::new(&e, &e.register(ClockStub, ()));
    clock.set(&running());
    Fixture {
        e,
        topics,
        clock,
        admin,
        issuer_wasm,
    }
}

/// A topics contract bound to a vault clock, with setup still open.
fn bound<'a>() -> Fixture<'a> {
    let f = unbound();
    f.topics.bind_vault(&f.clock.address);
    f
}

fn finished<'a>() -> Fixture<'a> {
    let f = bound();
    f.topics.finish_setup();
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
        instance_ttl(&f.e, &f.topics.address),
        INSTANCE_EXTEND_AMOUNT
    );
    assert_eq!(f.topics.issuer_wasm(), f.issuer_wasm);
    assert_eq!(f.topics.get_admin(), Some(f.admin.clone()));
}
