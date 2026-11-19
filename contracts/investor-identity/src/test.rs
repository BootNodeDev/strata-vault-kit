extern crate std;

use soroban_sdk::{
    contract, contractimpl,
    testutils::{Address as _, MockAuth, MockAuthInvoke},
    Address, Bytes, BytesN, Env, IntoVal, String,
};
use stellar_tokens::rwa::identity_verification::identity_claims::generate_claim_id;

use crate::{InvestorIdentity, InvestorIdentityClient};

#[contract]
struct AcceptingIssuer;

#[contractimpl]
impl AcceptingIssuer {
    pub fn is_claim_valid(
        _e: &Env,
        _identity: Address,
        _topic: u32,
        _scheme: u32,
        _signature: Bytes,
        _data: Bytes,
    ) {
    }
}

const TOPIC: u32 = 1;

struct Fixture<'a> {
    e: Env,
    owner: Address,
    issuer: Address,
    identity: InvestorIdentityClient<'a>,
}

fn fixture<'a>() -> Fixture<'a> {
    let e = Env::default();
    e.mock_all_auths();
    let owner = Address::generate(&e);
    let issuer = e.register(AcceptingIssuer, ());
    let id = e.register(InvestorIdentity, (&owner,));
    let identity = InvestorIdentityClient::new(&e, &id);
    e.set_auths(&[]);
    Fixture {
        e,
        owner,
        issuer,
        identity,
    }
}

impl Fixture<'_> {
    fn add(&self, data: &[u8]) -> BytesN<32> {
        self.e.mock_all_auths();
        self.identity.add_claim(
            &TOPIC,
            &1,
            &self.issuer,
            &Bytes::from_slice(&self.e, b"sig"),
            &Bytes::from_slice(&self.e, data),
            &String::from_str(&self.e, ""),
        )
    }
}

#[test]
fn only_the_owner_adds_a_claim() {
    let f = fixture();
    let stranger = Address::generate(&f.e);
    let (sig, data, uri) = (
        Bytes::from_slice(&f.e, b"sig"),
        Bytes::from_slice(&f.e, b"d"),
        String::from_str(&f.e, ""),
    );
    f.e.mock_auths(&[MockAuth {
        address: &stranger,
        invoke: &MockAuthInvoke {
            contract: &f.identity.address,
            fn_name: "add_claim",
            args: (&TOPIC, &1u32, &f.issuer, &sig, &data, &uri).into_val(&f.e),
            sub_invokes: &[],
        },
    }]);
    assert!(f
        .identity
        .try_add_claim(&TOPIC, &1, &f.issuer, &sig, &data, &uri)
        .is_err());
    assert_eq!(f.identity.owner(), f.owner);
}

#[test]
fn a_claim_is_listed_under_its_topic() {
    let f = fixture();
    let id = f.add(b"payload");
    assert_eq!(id, generate_claim_id(&f.e, &f.issuer, TOPIC));
    let ids = f.identity.get_claim_ids_by_topic(&TOPIC);
    assert!(ids.contains(&id));
    let claim = f.identity.get_claim(&id);
    assert_eq!(claim.issuer, f.issuer);
    assert_eq!(claim.topic, TOPIC);
    assert_eq!(claim.data, Bytes::from_slice(&f.e, b"payload"));
}

#[test]
fn adding_a_claim_again_replaces_it() {
    let f = fixture();
    let first = f.add(b"one");
    let second = f.add(b"two");
    assert_eq!(first, second);
    assert_eq!(f.identity.get_claim_ids_by_topic(&TOPIC).len(), 1);
    assert_eq!(
        f.identity.get_claim(&second).data,
        Bytes::from_slice(&f.e, b"two")
    );
}

#[test]
fn only_the_owner_removes_a_claim() {
    let f = fixture();
    let id = f.add(b"d");
    let stranger = Address::generate(&f.e);
    f.e.mock_auths(&[MockAuth {
        address: &stranger,
        invoke: &MockAuthInvoke {
            contract: &f.identity.address,
            fn_name: "remove_claim",
            args: (&id,).into_val(&f.e),
            sub_invokes: &[],
        },
    }]);
    assert!(f.identity.try_remove_claim(&id).is_err());
    assert!(f.identity.get_claim_ids_by_topic(&TOPIC).contains(&id));

    f.e.mock_all_auths();
    f.identity.remove_claim(&id);
    assert!(f.identity.get_claim_ids_by_topic(&TOPIC).is_empty());
}
