//! Whether the identity setup behind this verifier is ready for a vault. Every
//! read of another contract goes through `try_`, so a contract that does not
//! answer makes the setup not ready rather than failing the vault's call.

use soroban_sdk::{contractclient, Address, Env};
use stellar_access::access_control::{self, AccessControlClient};
use stellar_tokens::rwa::identity_verification::storage;
use strata_bindings::VaultBindingClient;
use strata_timelock::setup;

use crate::{protocol, verification::is_contract};

#[allow(dead_code)]
#[contractclient(name = "CompletenessClient")]
trait Completeness {
    fn is_complete(e: Env) -> bool;
}

#[allow(dead_code)]
#[contractclient(name = "BoundVerifierClient")]
trait BoundVerifier {
    fn verifier(e: Env) -> Address;
}

pub(crate) fn ready_for(e: &Env, vault: &Address, governance: &Address) -> bool {
    let registry = storage::identity_registry_storage(e);
    let topics = storage::claim_topics_and_issuers(e);
    is_contract(&registry)
        && is_contract(&topics)
        && access_control::get_admin(e).as_ref() == Some(governance)
        && governed_by(e, &registry, governance)
        && governed_by(e, &topics, governance)
        && matches!(
            CompletenessClient::new(e, &topics).try_is_complete(),
            Ok(Ok(true))
        )
        && protocol::is_protocol(e, vault)
        && setup::source(e).as_ref() == Some(vault)
        && !setup::is_open(e)
        && bound_to(e, &registry, vault)
        && bound_to(e, &topics, vault)
        && matches!(
            BoundVerifierClient::new(e, &registry).try_verifier(),
            Ok(Ok(verifier)) if verifier == e.current_contract_address()
        )
}

fn governed_by(e: &Env, contract: &Address, governance: &Address) -> bool {
    matches!(
        AccessControlClient::new(e, contract).try_get_admin(),
        Ok(Ok(Some(admin))) if admin == *governance
    )
}

/// The vault's own test of a bound contract: it reads the vault's clock and
/// its setup has closed, so its changes wait for the vault's timelock.
fn bound_to(e: &Env, contract: &Address, vault: &Address) -> bool {
    let binding = VaultBindingClient::new(e, contract);
    matches!(binding.try_vault(), Ok(Ok(Some(bound))) if bound == *vault)
        && matches!(binding.try_setup_open(), Ok(Ok(false)))
}
