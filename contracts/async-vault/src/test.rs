extern crate std;

use soroban_sdk::Env;

use crate::AsyncVault;

/// The crate carries no entrypoints yet. This pins that the contract type is
/// registrable, which is what the rest of the vault work builds on.
#[test]
fn contract_registers() {
    let e = Env::default();
    let first = e.register(AsyncVault, ());
    let second = e.register(AsyncVault, ());
    assert_ne!(first, second);
}
