use soroban_sdk::{testutils::Address as _, Address, Env, String};

use crate::{ShareToken, ShareTokenClient};

fn setup(e: &Env) -> ShareTokenClient<'_> {
    let admin = Address::generate(e);
    let manager = Address::generate(e);
    let compliance = Address::generate(e);
    let identity_verifier = Address::generate(e);

    let id = e.register(
        ShareToken,
        (
            String::from_str(e, "RWA Vault USDC"),
            String::from_str(e, "rwsUSDC"),
            admin,
            manager,
            compliance,
            identity_verifier,
        ),
    );
    ShareTokenClient::new(e, &id)
}

#[test]
fn constructor_sets_7_decimals() {
    let e = Env::default();
    e.mock_all_auths();

    let token = setup(&e);

    assert_eq!(token.decimals(), 7);
}
