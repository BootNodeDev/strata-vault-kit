mod compliance;
mod constructor;
mod controls;
mod conversions;
mod deposit;
mod epochs;
mod oracle_pricing;
mod redeem;
mod treasury;

extern crate std;

pub(crate) use soroban_sdk::{
    symbol_short,
    testutils::{Address as _, Ledger as _, MockAuth, MockAuthInvoke},
    token::{StellarAssetClient, TokenClient},
    Address, Env, IntoVal, String,
};

pub(crate) use ::compliance::{Compliance, ComplianceClient};
pub(crate) use identity_verifier::{IdentityVerifier, IdentityVerifierClient};
pub(crate) use nav_oracle::{NavOracleContract, NavOracleContractClient, NavReport, OracleConfig};
pub(crate) use share_token::{ShareToken, ShareTokenClient};

pub(crate) use stellar_contract_utils::math::wad::WAD_SCALE;

pub(crate) use crate::{AsyncVault, AsyncVaultClient, EpochStatus};

fn wad(whole: i128) -> i128 {
    whole * WAD_SCALE
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
    custodian: Address,
    admin: Address,
}

impl Fixture<'_> {
    fn investor(&self, funded: i128) -> Address {
        let who = self.unverified_investor(funded);
        self.identity.allow(&who, &true, &self.admin);
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

    fn shares(&self, who: &Address) -> i128 {
        self.share.balance(who)
    }

    fn attest(&self, nav_per_share: i128) {
        self.oracle.attest(
            &NavReport {
                nav_per_share,
                timestamp: 0,
                expires_at: 1_000_000,
            },
            &self.attester,
        );
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
}

fn setup<'a>() -> Fixture<'a> {
    let e = Env::default();
    e.mock_all_auths();
    e.ledger().set_timestamp(10_000);

    let issuer = Address::generate(&e);
    let asset = e.register_stellar_asset_contract_v2(issuer).address();
    let manager = Address::generate(&e);
    let treasury = Address::generate(&e);
    let custodian = Address::generate(&e);
    let admin = Address::generate(&e);
    let attester = Address::generate(&e);

    let compliance = ComplianceClient::new(&e, &e.register(Compliance, (admin.clone(),)));
    let identity = IdentityVerifierClient::new(&e, &e.register(IdentityVerifier, (admin.clone(),)));

    let share = ShareTokenClient::new(
        &e,
        &e.register(
            ShareToken,
            (
                String::from_str(&e, "Strata Vault USDC"),
                String::from_str(&e, "bvUSDC"),
                admin.clone(),
                admin.clone(),
                compliance.address.clone(),
                identity.address.clone(),
            ),
        ),
    );
    compliance.bind_token(&share.address, &admin);

    let oracle = NavOracleContractClient::new(
        &e,
        &e.register(
            NavOracleContract,
            (
                admin.clone(),
                attester.clone(),
                OracleConfig {
                    freshness_duration: 3_600,
                    cooldown_secs: 0,
                    max_deviation_bps: 10_000,
                    min_answer: 1,
                    max_answer: 1_000 * WAD_SCALE,
                },
            ),
        ),
    );

    let contract_id = e.register(
        AsyncVault,
        (
            &asset,
            &share.address,
            &oracle.address,
            &manager,
            &treasury,
            &admin,
        ),
    );
    share.grant_role(&contract_id, &symbol_short!("manager"), &admin);

    Fixture {
        vault: AsyncVaultClient::new(&e, &contract_id),
        share,
        identity,
        oracle,
        attester,
        asset,
        manager,
        treasury,
        custodian,
        admin,
        e,
    }
}
