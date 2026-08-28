use soroban_sdk::{testutils::Address as _, Address, Env, String};

use crate::{ShareToken, ShareTokenClient};
use compliance::{Compliance, ComplianceClient};
use identity_verifier::{IdentityVerifier, IdentityVerifierClient};

#[test]
fn manager_mints_to_allowlisted_account() {
    let e = Env::default();
    e.mock_all_auths();

    let admin = Address::generate(&e);
    let manager = Address::generate(&e);
    let receiver = Address::generate(&e);

    let compliance = ComplianceClient::new(&e, &e.register(Compliance, (admin.clone(),)));
    let identity = IdentityVerifierClient::new(&e, &e.register(IdentityVerifier, (admin.clone(),)));

    let token = ShareTokenClient::new(
        &e,
        &e.register(
            ShareToken,
            (
                String::from_str(&e, "Strata Vault USDC"),
                String::from_str(&e, "bvUSDC"),
                admin.clone(),
                manager.clone(),
                compliance.address.clone(),
                identity.address.clone(),
            ),
        ),
    );

    compliance.bind_token(&token.address, &admin); // compliance rejects ops from unbound tokens
    identity.allow(&receiver, &true, &admin);

    token.mint(&receiver, &100, &manager);

    assert_eq!(token.balance(&receiver), 100);
}

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
