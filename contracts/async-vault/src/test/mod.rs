mod cancel;
mod clawback;
mod compliance;
mod constructor;
mod controls;
mod conversions;
mod delisted;
mod deposit;
mod deposit_cap;
mod epochs;
mod events;
mod governance;
mod guards;
mod health;
mod lock_policy;
mod multi_epoch;
mod notice;
mod oracle_pricing;
mod oracle_swap;
mod pricing;
mod redeem;
mod sealing;
mod settlement;
mod setup;
mod share_returns;
mod signatures;
mod supply;
mod timing;
mod treasury;
mod ttl;
mod upgrade;
mod wind_down;

extern crate std;

use soroban_sdk::{contract, contractimpl};
pub(crate) use soroban_sdk::{
    symbol_short,
    testutils::{Address as _, Ledger as _},
    token::{StellarAssetClient, TokenClient},
    Address, BytesN, Env, String,
};

pub(crate) use ::compliance::{Compliance, ComplianceChange, ComplianceClient};
pub(crate) use identity_verifier::{IdentityVerifier, IdentityVerifierClient};
pub(crate) use nav_oracle::{
    NavInput, NavOracleContract, NavOracleContractClient, OracleConfig, MIN_ANSWER,
};
pub(crate) use share_token::{ShareToken, ShareTokenClient};

pub(crate) use stellar_contract_utils::math::wad::WAD_SCALE;
use stellar_tokens::rwa::compliance::ComplianceHook;
pub(crate) use strata_timelock::DAY_DURATION;

pub(crate) use crate::{
    AsyncVault, AsyncVaultClient, DirectUnitPricing, EpochStatus, PricingScheme, VaultChange,
    VaultError, VaultPendingChange, VaultRoles, WindDownStatus, MAX_NOTICE_SECS, MAX_UPGRADE_DELAY,
    MAX_WIND_DOWN_DELAY, MIN_UPGRADE_DELAY, MIN_WIND_DOWN_DELAY,
};

fn wad(whole: i128) -> i128 {
    whole * WAD_SCALE
}

fn nav_input(e: &Env, nav_per_share: i128, expires_at: u64) -> NavInput {
    NavInput {
        nav_per_share,
        expires_at,
        proof_hash: BytesN::from_array(e, &[7; 32]),
        proof_uri: String::from_str(e, "ipfs://strata-proof"),
    }
}

struct Fixture<'a> {
    e: Env,
    vault: AsyncVaultClient<'a>,
    share: ShareTokenClient<'a>,
    identity: IdentityVerifierClient<'a>,
    oracle: NavOracleContractClient<'a>,
    attester: Address,
    asset: Address,
    manager: Address,
    treasury: Address,
    guardian: Address,
    custodian: Address,
    admin: Address,
    compliance: Address,
}

impl Fixture<'_> {
    /// Moves the ledger clock and its sequence together, so time-dependent and
    /// TTL-dependent behaviour can both be reached. `setup` pins the clock, and
    /// nothing else moves it.
    fn advance(&self, secs: u64) {
        self.e.ledger().with_mut(|l| {
            l.timestamp += secs;
            l.sequence_number += (secs / 5).max(1) as u32;
        });
    }

    /// Signs one call to the vault as `who` and nothing else, so the call's own
    /// role check is the only thing that can refuse it.
    fn sign_only_as(&self, who: &Address, fn_name: &str, args: soroban_sdk::Vec<soroban_sdk::Val>) {
        use soroban_sdk::testutils::{MockAuth, MockAuthInvoke};
        self.e.mock_auths(&[MockAuth {
            address: who,
            invoke: &MockAuthInvoke {
                contract: &self.vault.address,
                fn_name,
                args,
                sub_invokes: &[],
            },
        }]);
    }

    /// The last call asked `who` alone to sign, once, on exactly this call.
    fn signed_once_by(
        &self,
        who: &Address,
        fn_name: &str,
        args: soroban_sdk::Vec<soroban_sdk::Val>,
    ) {
        use soroban_sdk::testutils::{AuthorizedFunction, AuthorizedInvocation};
        assert_eq!(
            self.e.auths(),
            std::vec![(
                who.clone(),
                AuthorizedInvocation {
                    function: AuthorizedFunction::Contract((
                        self.vault.address.clone(),
                        soroban_sdk::Symbol::new(&self.e, fn_name),
                        args,
                    )),
                    sub_invocations: std::vec![],
                },
            )]
        );
    }

    fn investor(&self, funded: i128) -> Address {
        let who = self.unverified_investor(funded);
        self.identity.allow(&who, &true);
        who
    }

    fn unverified_investor(&self, funded: i128) -> Address {
        let who = Address::generate(&self.e);
        StellarAssetClient::new(&self.e, &self.asset).mint(&who, &funded);
        who
    }

    fn balance(&self, who: &Address) -> i128 {
        TokenClient::new(&self.e, &self.asset).balance(who)
    }

    /// The asset's issuer takes `amount` out of the vault's balance.
    fn claw_back(&self, amount: i128) {
        StellarAssetClient::new(&self.e, &self.asset).clawback(&self.vault.address, &amount);
    }

    fn shares(&self, who: &Address) -> i128 {
        self.share.balance(who)
    }

    /// Posts a report that the feed's own freshness window bounds, waiting out
    /// the cooldown first when the last report is too recent.
    fn attest(&self, nav_per_share: i128) {
        self.wait_out_the_cooldown();
        self.oracle
            .attest(&nav_input(&self.e, nav_per_share, u64::MAX), &self.attester);
    }

    fn wait_out_the_cooldown(&self) {
        let Ok(Ok(latest)) = self.oracle.try_latest() else {
            return;
        };
        let ready = latest.accepted_at + self.oracle.config().cooldown_secs;
        let now = self.e.ledger().timestamp();
        if now < ready {
            self.advance(ready - now);
        }
    }

    fn holder(&self, shares: i128) -> Address {
        let who = self.investor(shares * 2);
        let epoch = self.vault.request_deposit(&who, &(shares * 2));
        self.fulfill_epoch(wad(2));
        self.vault.claim_deposit(&who, &epoch);
        who
    }

    fn close_epoch(&self) -> u64 {
        self.vault.close_epoch(&self.manager)
    }

    fn fulfill_epoch(&self, nav_per_share: i128) -> u64 {
        let epoch = self.close_epoch();
        self.fulfill_epoch_at(epoch, nav_per_share);
        epoch
    }

    fn fulfill_epoch_at(&self, epoch: u64, nav_per_share: i128) {
        self.attest(nav_per_share);
        self.vault.fulfill_epoch(&epoch);
    }

    fn empty_reserve(&self) {
        let free = self.vault.free_reserve();
        if free > 0 {
            self.vault.deploy_to_custodian(&self.treasury, &free);
        }
    }

    /// After setup, a module lands only through the compliance contract's timelock.
    fn add_compliance_module(&self, hook: ComplianceHook, module: &Address) {
        let rules = ComplianceClient::new(&self.e, &self.share.compliance());
        let id = rules.propose_change(&ComplianceChange::AddModule(hook, module.clone()));
        self.advance(MIN_UPGRADE_DELAY);
        rules.apply_change(&id);
    }
}

pub(crate) fn distinct_roles(e: &Env) -> VaultRoles {
    VaultRoles {
        governance: Address::generate(e),
        manager: Address::generate(e),
        treasury: Address::generate(e),
        guardian: Address::generate(e),
        compliance: Address::generate(e),
        attester: Address::generate(e),
    }
}

/// Asserts a call was refused with exactly this error. Entrypoints panic
/// rather than returning `Result`, so the client hands back the SDK's error
/// type and the vault's variant converts into it.
pub(crate) fn refused<T: core::fmt::Debug + PartialEq, E: core::fmt::Debug + PartialEq>(
    result: Result<Result<T, E>, Result<soroban_sdk::Error, soroban_sdk::InvokeError>>,
    expected: VaultError,
) {
    assert_eq!(result, Err(Ok(expected.into())));
}

pub(crate) fn register_with(e: &Env, roles: VaultRoles) -> Address {
    let issuer = Address::generate(e);
    let asset = e.register_stellar_asset_contract_v2(issuer).address();
    e.register(AsyncVault, (&asset, &asset, &asset, roles))
}

/// The permissive feed most tests want: the shortest cooldown, no effective cap.
fn open_feed() -> OracleConfig {
    OracleConfig {
        freshness_duration: 3_600,
        cooldown_secs: 1,
        max_up_bps: 10_000,
        max_down_bps: 10_000,
        min_answer: MIN_ANSWER,
        max_answer: 1_000 * WAD_SCALE,
    }
}

fn setup<'a>() -> Fixture<'a> {
    setup_with_feed(open_feed())
}

/// A vault whose wiring is complete but whose own setup is still open: admin
/// changes are instant and the vault takes no request.
fn setup_unfinished<'a>() -> Fixture<'a> {
    miswired(Miswire::Nothing)
}

/// A wiring step a test leaves out or gets wrong, to see `finish_setup` refuse.
#[derive(Clone, Copy, Debug, PartialEq)]
enum Miswire {
    Nothing,
    TokenUnbound,
    TokenBoundElsewhere,
    TokenSetupOpen,
    OracleUnbound,
    OracleBoundElsewhere,
    OracleSetupOpen,
    NoManagerRole,
    OtherManager,
    SecondManager,
    PreMinted,
    NotAllowlisted,
    VaultFrozen,
    ComplianceUnbound,
    ComplianceBoundElsewhere,
    ComplianceSetupOpen,
    AssetDecimalsDiffer,
    AssetIsShareToken,
    /// The compliance contract passed as the oracle: bound here, but no feed.
    OracleNotAFeed,
    NoCustodian,
    CustodianIsVault,
    EpochAdvanced,
    DepositBooked,
    RedemptionBooked,
    Committed,
    SharesOwed,
    SharesToBurn,
}

/// An asset with six decimals, where the share token has seven.
#[contract]
struct SixDecimalAsset;

#[contractimpl]
impl SixDecimalAsset {
    pub fn decimals(_e: Env) -> u32 {
        6
    }
}

/// A vault left in setup, wired except for `miswire`.
fn miswired<'a>(miswire: Miswire) -> Fixture<'a> {
    build(
        open_feed(),
        |e, args| e.register(ShareToken, args),
        miswire,
        false,
    )
}

/// Builds the vault against a caller-chosen feed, so cooldown, freshness and the
/// deviation cap can be exercised from a vault test rather than only an oracle one.
fn setup_with_feed<'a>(feed: OracleConfig) -> Fixture<'a> {
    setup_with(feed, |e, args| e.register(ShareToken, args))
}

/// Builds a vault set whose setup has finished, around a token the caller
/// registers, so a test can run the token's built Wasm instead of its native
/// code.
fn setup_with<'a>(
    feed: OracleConfig,
    register_token: impl FnOnce(&Env, TokenArgs) -> Address,
) -> Fixture<'a> {
    build(feed, register_token, Miswire::Nothing, true)
}

/// The share token's constructor arguments, in order.
type TokenArgs = (String, String, Address, Address, Address, Address);

/// Wires the set the way the deploy does, custodian included, apart from
/// `miswire`, then finishes the vault's setup when `finish` is set.
fn build<'a>(
    feed: OracleConfig,
    register_token: impl FnOnce(&Env, TokenArgs) -> Address,
    miswire: Miswire,
    finish: bool,
) -> Fixture<'a> {
    let e = Env::default();
    e.mock_all_auths();
    e.ledger().set_timestamp(10_000);

    let issuer = Address::generate(&e);
    let sac = e.register_stellar_asset_contract_v2(issuer);
    // A balance can be clawed back only if the flag was set when it was created.
    sac.issuer()
        .set_flag(soroban_sdk::testutils::IssuerFlags::ClawbackEnabledFlag);
    let asset = sac.address();
    let manager = Address::generate(&e);
    let treasury = Address::generate(&e);
    let guardian = Address::generate(&e);
    let custodian = Address::generate(&e);
    let admin = Address::generate(&e);
    let attester = Address::generate(&e);
    let compliance_authority = Address::generate(&e);

    let compliance = ComplianceClient::new(&e, &e.register(Compliance, (admin.clone(),)));
    let identity = IdentityVerifierClient::new(
        &e,
        &e.register(IdentityVerifier, (compliance_authority.clone(),)),
    );

    let share = ShareTokenClient::new(
        &e,
        &register_token(
            &e,
            (
                String::from_str(&e, "Strata Vault USDC"),
                String::from_str(&e, "bvUSDC"),
                admin.clone(),
                compliance_authority.clone(),
                compliance.address.clone(),
                identity.address.clone(),
            ),
        ),
    );
    if miswire != Miswire::ComplianceUnbound {
        compliance.bind_token(&share.address, &admin);
    }

    let oracle = NavOracleContractClient::new(
        &e,
        &e.register(
            NavOracleContract,
            (admin.clone(), attester.clone(), guardian.clone(), feed),
        ),
    );

    let vault_asset = match miswire {
        Miswire::AssetDecimalsDiffer => e.register(SixDecimalAsset, ()),
        Miswire::AssetIsShareToken => share.address.clone(),
        _ => asset.clone(),
    };
    let vault_oracle = match miswire {
        Miswire::OracleNotAFeed => compliance.address.clone(),
        _ => oracle.address.clone(),
    };
    let contract_id = e.register(
        AsyncVault,
        (
            &vault_asset,
            &share.address,
            &vault_oracle,
            VaultRoles {
                governance: admin.clone(),
                manager: manager.clone(),
                treasury: treasury.clone(),
                guardian: guardian.clone(),
                compliance: compliance_authority.clone(),
                attester: attester.clone(),
            },
        ),
    );
    match miswire {
        Miswire::NoManagerRole => {}
        Miswire::OtherManager => {
            share.grant_role(&Address::generate(&e), &symbol_short!("manager"), &admin)
        }
        _ => share.grant_role(&contract_id, &symbol_short!("manager"), &admin),
    }
    if miswire == Miswire::SecondManager {
        share.grant_role(&Address::generate(&e), &symbol_short!("manager"), &admin);
    }
    if miswire == Miswire::PreMinted {
        // The token's admin mints during the token's own setup, then steps back.
        let holder = Address::generate(&e);
        identity.allow(&holder, &true);
        share.grant_role(&admin, &symbol_short!("manager"), &admin);
        share.mint(&holder, &100, &admin);
        share.revoke_role(&admin, &symbol_short!("manager"), &admin);
    }
    // Converting a delisted holder's deposit mints into the vault's own escrow.
    if miswire != Miswire::NotAllowlisted {
        identity.allow(&contract_id, &true);
    }
    if miswire == Miswire::VaultFrozen {
        // Until `bind_vault`, the token does not know this address is its vault.
        share.set_address_frozen(&contract_id, &true, &compliance_authority);
    }
    match miswire {
        Miswire::TokenUnbound => {}
        Miswire::TokenBoundElsewhere => {
            share.bind_vault(&register_with(&e, distinct_roles(&e)));
            share.finish_setup();
        }
        Miswire::TokenSetupOpen => share.bind_vault(&contract_id),
        _ => {
            share.bind_vault(&contract_id);
            share.finish_setup();
        }
    }
    match miswire {
        Miswire::OracleUnbound => {}
        Miswire::OracleBoundElsewhere => {
            oracle.bind_vault(&register_with(&e, distinct_roles(&e)));
            oracle.finish_setup();
        }
        Miswire::OracleSetupOpen => oracle.bind_vault(&contract_id),
        _ => {
            oracle.bind_vault(&contract_id);
            oracle.finish_setup();
        }
    }
    match miswire {
        Miswire::ComplianceUnbound => {}
        Miswire::ComplianceBoundElsewhere => {
            compliance.bind_vault(&register_with(&e, distinct_roles(&e)));
            compliance.finish_setup();
        }
        Miswire::ComplianceSetupOpen => compliance.bind_vault(&contract_id),
        _ => {
            compliance.bind_vault(&contract_id);
            compliance.finish_setup();
        }
    }
    let vault = AsyncVaultClient::new(&e, &contract_id);
    match miswire {
        Miswire::NoCustodian => {}
        // No entrypoint takes the vault as its own custodian, so the test stores it.
        Miswire::CustodianIsVault => e.as_contract(&contract_id, || {
            crate::state::set_addr(&e, &crate::keys::DataKey::Custodian, &contract_id)
        }),
        _ => vault.set_custodian(&custodian),
    }
    // No entrypoint books these during setup, so the test writes the vault's storage.
    match miswire {
        Miswire::EpochAdvanced => {
            e.as_contract(&contract_id, || crate::state::set_current_epoch(&e, 2))
        }
        Miswire::DepositBooked => e.as_contract(&contract_id, || {
            let mut epoch = crate::state::get_epoch(&e, crate::state::FIRST_EPOCH).unwrap();
            epoch.total_deposited = 100;
            crate::state::set_epoch(&e, crate::state::FIRST_EPOCH, &epoch);
        }),
        Miswire::RedemptionBooked => e.as_contract(&contract_id, || {
            let mut epoch = crate::state::get_epoch(&e, crate::state::FIRST_EPOCH).unwrap();
            epoch.total_shares_redeeming = 100;
            crate::state::set_epoch(&e, crate::state::FIRST_EPOCH, &epoch);
        }),
        Miswire::Committed => e.as_contract(&contract_id, || crate::state::set_committed(&e, 100)),
        Miswire::SharesOwed => e.as_contract(&contract_id, || {
            crate::state::set_pending_mint_shares(&e, 100)
        }),
        Miswire::SharesToBurn => e.as_contract(&contract_id, || {
            crate::state::set_pending_burn_shares(&e, 100)
        }),
        _ => {}
    }
    if finish {
        vault.finish_setup();
        // Deposits need a valid report; a second on, so the next sealed epoch is not priced by it.
        oracle.attest(
            &nav_input(&e, oracle.config().max_answer / 2, u64::MAX),
            &attester,
        );
        e.ledger().set_timestamp(e.ledger().timestamp() + 1);
    }

    Fixture {
        vault,
        share,
        identity,
        oracle,
        attester,
        asset,
        manager,
        treasury,
        guardian,
        custodian,
        admin,
        compliance: compliance_authority,
        e,
    }
}
