//! Each guard passes while its condition holds and refuses with its error once
//! it does not.

use soroban_sdk::{
    contract, contractimpl, symbol_short,
    testutils::Address as _,
    xdr::{ScErrorCode, ScErrorType},
    Address, BytesN, Env, InvokeError, String, Symbol,
};
use stellar_tokens::rwa::RWAError;
use strata_timelock::{Clock, MIN_DELAY};

use crate::guards;
use crate::{ShareToken, ShareTokenClient, ShareTokenError, TokenChange, MAX_REFERENCE_LEN};
use identity_verifier::{IdentityVerifier, IdentityVerifierClient};

/// Plays the vault: the token binds only to an address that reports a clock.
#[contract]
struct VaultStub;

#[contractimpl(contracttrait)]
impl strata_timelock::ClockSource for VaultStub {
    fn timelock_clock(_e: &Env) -> Clock {
        Clock {
            delay: MIN_DELAY,
            exit_window: 0,
            paused_secs: 0,
            paused: false,
            winding_down: false,
        }
    }
}

struct Fixture<'a> {
    e: Env,
    token: ShareTokenClient<'a>,
    identity: IdentityVerifierClient<'a>,
    vault: Address,
    admin: Address,
    compliance_authority: Address,
}

impl Fixture<'_> {
    fn finish_setup(&self) {
        self.token.bind_vault(&self.vault);
        self.token.finish_setup();
    }
}

fn setup<'a>() -> Fixture<'a> {
    let e = Env::default();
    e.mock_all_auths();
    let admin = Address::generate(&e);
    let compliance_authority = Address::generate(&e);
    let identity = IdentityVerifierClient::new(&e, &e.register(IdentityVerifier, (admin.clone(),)));
    let token = ShareTokenClient::new(
        &e,
        &e.register(
            ShareToken,
            (
                String::from_str(&e, "Strata Vault USDC"),
                String::from_str(&e, "bvUSDC"),
                admin.clone(),
                compliance_authority.clone(),
                Address::generate(&e),
                identity.address.clone(),
            ),
        ),
    );
    let vault = e.register(VaultStub, ());
    Fixture {
        e,
        token,
        identity,
        vault,
        admin,
        compliance_authority,
    }
}

/// Runs `guard` inside the token, as an entrypoint would.
fn run(f: &Fixture, guard: impl FnOnce()) -> Result<(), Result<soroban_sdk::Error, InvokeError>> {
    f.e.try_as_contract::<(), soroban_sdk::Error>(&f.token.address, guard)
}

fn holds(f: &Fixture, guard: impl FnOnce()) {
    assert_eq!(run(f, guard), Ok(()));
}

fn refuses(f: &Fixture, error: impl Into<soroban_sdk::Error>, guard: impl FnOnce()) {
    assert_eq!(run(f, guard), Err(Ok(error.into())));
}

#[test]
fn setup_open_refuses_once_setup_has_finished() {
    let f = setup();
    holds(&f, || guards::setup_open(&f.e));

    f.finish_setup();
    refuses(&f, ShareTokenError::SetupClosed, || {
        guards::setup_open(&f.e)
    });
}

#[test]
fn no_hand_over_pending_refuses_while_an_offer_is_open() {
    let f = setup();
    holds(&f, || guards::no_hand_over_pending(&f.e));

    let next = Address::generate(&f.e);
    f.token
        .transfer_admin_role(&next, &(f.e.ledger().sequence() + 100));
    refuses(&f, ShareTokenError::AdminTransferPending, || {
        guards::no_hand_over_pending(&f.e)
    });

    f.token.transfer_admin_role(&next, &0);
    holds(&f, || guards::no_hand_over_pending(&f.e));
}

#[test]
fn not_a_second_upgrade_refuses_an_upgrade_while_one_waits() {
    let f = setup();
    f.finish_setup();
    let upgrade = TokenChange::Upgrade(BytesN::from_array(&f.e, &[1; 32]));
    let grant = TokenChange::GrantRole(symbol_short!("manager"), Address::generate(&f.e));
    holds(&f, || guards::not_a_second_upgrade(&f.e, &upgrade));

    f.token.propose_change(&upgrade);
    refuses(&f, ShareTokenError::UpgradeAlreadyPending, || {
        guards::not_a_second_upgrade(&f.e, &upgrade)
    });
    holds(&f, || guards::not_a_second_upgrade(&f.e, &grant));
}

#[test]
fn caller_is_admin_refuses_anyone_but_the_admin() {
    let f = setup();
    let stranger = Address::generate(&f.e);
    holds(&f, || guards::caller_is_admin(&f.e, &f.admin));

    for who in [&f.compliance_authority, &stranger] {
        refuses(&f, ShareTokenError::AdminRequired, || {
            guards::caller_is_admin(&f.e, who)
        });
    }
}

#[test]
fn admin_co_signs_refuses_one_account_signing_as_both() {
    let f = setup();
    holds(&f, || guards::admin_co_signs(&f.e, &f.compliance_authority));
    refuses(&f, ShareTokenError::CoSignRequired, || {
        guards::admin_co_signs(&f.e, &f.admin)
    });

    f.e.set_auths(&[]);
    assert_eq!(
        run(&f, || guards::admin_co_signs(&f.e, &f.compliance_authority)),
        Err(Ok(soroban_sdk::Error::from_type_and_code(
            ScErrorType::Auth,
            ScErrorCode::InvalidAction
        )))
    );
}

#[test]
fn valid_reference_refuses_an_empty_or_overlong_reference() {
    let f = setup();
    let bytes = [b'x'; MAX_REFERENCE_LEN as usize + 1];
    let reference = |len: u32| String::from_bytes(&f.e, &bytes[..len as usize]);
    let (empty, shortest, longest, overlong) = (
        reference(0),
        reference(1),
        reference(MAX_REFERENCE_LEN),
        reference(MAX_REFERENCE_LEN + 1),
    );

    holds(&f, || guards::valid_reference(&f.e, &shortest));
    holds(&f, || guards::valid_reference(&f.e, &longest));
    refuses(&f, ShareTokenError::InvalidReference, || {
        guards::valid_reference(&f.e, &empty)
    });
    refuses(&f, ShareTokenError::InvalidReference, || {
        guards::valid_reference(&f.e, &overlong)
    });
}

#[test]
fn not_vault_address_refuses_the_bound_vault() {
    let f = setup();
    let holder = Address::generate(&f.e);
    holds(&f, || guards::not_vault_address(&f.e, &f.vault));

    f.token.bind_vault(&f.vault);
    refuses(&f, ShareTokenError::VaultAddress, || {
        guards::not_vault_address(&f.e, &f.vault)
    });
    holds(&f, || guards::not_vault_address(&f.e, &holder));
}

#[test]
fn not_freezing_vault_refuses_only_a_freeze_of_the_vault() {
    let f = setup();
    let holder = Address::generate(&f.e);
    f.token.bind_vault(&f.vault);

    refuses(&f, ShareTokenError::VaultAddress, || {
        guards::not_freezing_vault(&f.e, &f.vault, true)
    });
    holds(&f, || guards::not_freezing_vault(&f.e, &f.vault, false));
    holds(&f, || guards::not_freezing_vault(&f.e, &holder, true));
}

#[test]
fn identity_verified_refuses_an_account_the_verifier_rejects() {
    let f = setup();
    let listed = Address::generate(&f.e);
    let stranger = Address::generate(&f.e);
    f.identity.allow(&listed, &true);

    holds(&f, || guards::identity_verified(&f.e, &listed));
    refuses(&f, RWAError::IdentityVerificationFailed, || {
        guards::identity_verified(&f.e, &stranger)
    });
}

#[test]
fn direct_change_allowed_refuses_after_setup() {
    let f = setup();
    holds(&f, || guards::direct_change_allowed(&f.e));

    f.finish_setup();
    refuses(&f, ShareTokenError::UseTimelock, || {
        guards::direct_change_allowed(&f.e)
    });
}

#[test]
fn direct_revoke_allowed_refuses_only_the_manager_role_after_setup() {
    let f = setup();
    let compliance = Symbol::new(&f.e, "compliance");
    holds(&f, || {
        guards::direct_revoke_allowed(&f.e, &symbol_short!("manager"))
    });

    f.finish_setup();
    holds(&f, || guards::direct_revoke_allowed(&f.e, &compliance));
    refuses(&f, ShareTokenError::UseTimelock, || {
        guards::direct_revoke_allowed(&f.e, &symbol_short!("manager"))
    });
}

#[test]
fn direct_hand_over_allowed_refuses_only_an_offer_after_setup() {
    let f = setup();
    holds(&f, || guards::direct_hand_over_allowed(&f.e, 100));

    f.finish_setup();
    holds(&f, || guards::direct_hand_over_allowed(&f.e, 0));
    refuses(&f, ShareTokenError::UseTimelock, || {
        guards::direct_hand_over_allowed(&f.e, 100)
    });
}
