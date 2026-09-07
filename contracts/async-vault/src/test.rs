extern crate std;

use soroban_sdk::{
    symbol_short,
    testutils::{Address as _, Ledger as _, MockAuth, MockAuthInvoke},
    token::{StellarAssetClient, TokenClient},
    Address, Env, IntoVal, String,
};

use compliance::{Compliance, ComplianceClient};
use identity_verifier::{IdentityVerifier, IdentityVerifierClient};
use nav_oracle::{NavOracleContract, NavOracleContractClient, NavReport, OracleConfig};
use share_token::{ShareToken, ShareTokenClient};

use stellar_contract_utils::math::wad::WAD_SCALE;

use crate::{AsyncVault, AsyncVaultClient, EpochStatus};

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
        self.strike(wad(2));
        self.vault.claim_deposit(&who, &epoch);
        who
    }

    fn strike(&self, nav_per_share: i128) -> u64 {
        self.attest(nav_per_share);
        self.vault.fulfill_epoch(&self.manager)
    }
}

fn setup<'a>() -> Fixture<'a> {
    let e = Env::default();
    e.mock_all_auths();
    e.ledger().set_timestamp(10_000);

    let issuer = Address::generate(&e);
    let asset = e.register_stellar_asset_contract_v2(issuer).address();
    let manager = Address::generate(&e);
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
        (&asset, &share.address, &oracle.address, &manager, &admin),
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
        admin,
        e,
    }
}

#[test]
fn test_successful_deployment() {
    let f = setup();

    assert_eq!(f.vault.asset(), f.asset);
    assert_eq!(f.vault.share_token(), f.share.address);
    assert_eq!(f.vault.manager(), f.manager);
    assert!(!f.vault.paused());

    let first = f.vault.get_epoch(&1).unwrap();
    assert_eq!(first.status, EpochStatus::Open);
    assert_eq!(first.total_deposited, 0);
    assert_eq!(first.share_price, 0);
}

#[test]
fn epoch_zero_is_the_absent_id() {
    let f = setup();
    assert_eq!(f.vault.get_epoch(&0), None);
}

#[test]
fn unwritten_epoch_reads_as_none() {
    let f = setup();
    assert_eq!(f.vault.get_epoch(&2), None);
}

#[test]
fn test_request_deposit_updates_epoch_and_user_state() {
    let f = setup();
    let user = f.investor(1_000);

    assert_eq!(f.vault.request_deposit(&user, &400), 1);

    assert_eq!(f.balance(&user), 600);
    assert_eq!(f.balance(&f.vault.address), 400);

    let epoch_info = f.vault.get_epoch(&1).unwrap();
    assert_eq!(epoch_info.total_deposited, 400);
    assert_eq!(epoch_info.status, EpochStatus::Open);

    let user_req = f.vault.get_deposit_request(&1, &user).unwrap();
    assert_eq!(user_req.amount, 400);
    assert!(!user_req.claimed);
}

#[test]
fn deposits_from_several_investors_accumulate_in_the_epoch() {
    let f = setup();
    let one = f.investor(1_000);
    let two = f.investor(1_000);

    f.vault.request_deposit(&one, &400);
    f.vault.request_deposit(&two, &250);

    assert_eq!(f.vault.get_epoch(&1).unwrap().total_deposited, 650);
    assert_eq!(f.balance(&f.vault.address), 650);
    assert_eq!(f.vault.get_deposit_request(&1, &one).unwrap().amount, 400);
    assert_eq!(f.vault.get_deposit_request(&1, &two).unwrap().amount, 250);
}

#[test]
fn a_second_request_from_the_same_investor_is_rejected() {
    let f = setup();
    let investor = f.investor(1_000);

    f.vault.request_deposit(&investor, &400);
    assert!(f.vault.try_request_deposit(&investor, &100).is_err());

    assert_eq!(f.vault.get_epoch(&1).unwrap().total_deposited, 400);
    assert_eq!(f.balance(&investor), 600);
}

#[test]
fn request_deposit_rejects_a_non_positive_amount() {
    let f = setup();
    let investor = f.investor(1_000);

    assert!(f.vault.try_request_deposit(&investor, &0).is_err());
    assert!(f.vault.try_request_deposit(&investor, &-1).is_err());
    assert_eq!(f.balance(&investor), 1_000);
}

#[test]
fn request_deposit_rejects_a_total_that_would_overflow() {
    let f = setup();
    let whale = f.investor(i128::MAX);
    let other = f.investor(1_000);

    f.vault.request_deposit(&whale, &(i128::MAX - 10));
    assert!(f.vault.try_request_deposit(&other, &11).is_err());

    assert_eq!(
        f.vault.get_epoch(&1).unwrap().total_deposited,
        i128::MAX - 10
    );
}

#[test]
fn request_deposit_needs_the_investor_authorisation() {
    let f = setup();
    let investor = f.investor(1_000);

    f.e.set_auths(&[]);
    assert!(f.vault.try_request_deposit(&investor, &100).is_err());
    assert_eq!(f.balance(&investor), 1_000);
}

#[test]
fn a_paused_vault_takes_no_deposits() {
    let f = setup();
    let investor = f.investor(1_000);

    f.vault.pause(&f.admin);
    assert!(f.vault.paused());
    assert!(f.vault.try_request_deposit(&investor, &100).is_err());

    f.vault.unpause(&f.admin);
    f.vault.request_deposit(&investor, &100);
    assert_eq!(f.vault.get_epoch(&1).unwrap().total_deposited, 100);
}

#[test]
fn only_the_admin_pauses() {
    let f = setup();
    let stranger = Address::generate(&f.e);

    f.e.mock_auths(&[MockAuth {
        address: &stranger,
        invoke: &MockAuthInvoke {
            contract: &f.vault.address,
            fn_name: "pause",
            args: (stranger.clone(),).into_val(&f.e),
            sub_invokes: &[],
        },
    }]);

    assert!(f.vault.try_pause(&stranger).is_err());
    assert!(!f.vault.paused());
}

#[test]
fn an_investor_without_a_request_reads_as_none() {
    let f = setup();
    let investor = f.investor(1_000);

    assert_eq!(f.vault.get_deposit_request(&1, &investor), None);
}

#[test]
fn test_manager_can_fulfill_epoch_and_rotate() {
    let f = setup();

    assert_eq!(f.strike(wad(2)), 2);

    let epoch_1 = f.vault.get_epoch(&1).unwrap();
    assert_eq!(epoch_1.status, EpochStatus::Fulfilled);
    assert_eq!(epoch_1.share_price, wad(2));

    let epoch_2 = f.vault.get_epoch(&2).unwrap();
    assert_eq!(epoch_2.status, EpochStatus::Open);
    assert_eq!(epoch_2.total_deposited, 0);
    assert_eq!(epoch_2.share_price, 0);

    assert_eq!(f.vault.current_epoch(), 2);
}

#[test]
#[should_panic(expected = "#2000")]
fn test_non_manager_cannot_fulfill() {
    let f = setup();
    let impostor = Address::generate(&f.e);
    f.attest(wad(2));

    f.vault.fulfill_epoch(&impostor);
}

#[test]
fn the_admin_is_not_the_manager() {
    let f = setup();
    f.attest(wad(2));

    assert!(f.vault.try_fulfill_epoch(&f.admin).is_err());
    assert_eq!(f.vault.current_epoch(), 1);
}

#[test]
fn fulfilling_keeps_the_struck_epoch_total() {
    let f = setup();
    let investor = f.investor(1_000);

    f.vault.request_deposit(&investor, &400);
    f.strike(wad(2));

    let epoch_1 = f.vault.get_epoch(&1).unwrap();
    assert_eq!(epoch_1.total_deposited, 400);
    assert_eq!(epoch_1.share_price, wad(2));
    assert_eq!(
        f.vault.get_deposit_request(&1, &investor).unwrap().amount,
        400
    );
}

#[test]
fn deposits_after_fulfilling_land_in_the_new_epoch() {
    let f = setup();
    let investor = f.investor(1_000);

    f.vault.request_deposit(&investor, &400);
    f.strike(wad(2));

    assert_eq!(f.vault.request_deposit(&investor, &300), 2);

    assert_eq!(f.vault.get_epoch(&1).unwrap().total_deposited, 400);
    assert_eq!(f.vault.get_epoch(&2).unwrap().total_deposited, 300);
    assert_eq!(
        f.vault.get_deposit_request(&2, &investor).unwrap().amount,
        300
    );
    assert_eq!(f.balance(&f.vault.address), 700);
}

#[test]
fn fulfill_is_rejected_before_the_first_attestation() {
    let f = setup();

    assert!(f.vault.try_fulfill_epoch(&f.manager).is_err());
    assert_eq!(f.vault.get_epoch(&1).unwrap().status, EpochStatus::Open);
    assert_eq!(f.vault.current_epoch(), 1);
}

#[test]
fn fulfill_is_rejected_while_the_ripcord_is_raised() {
    let f = setup();
    f.attest(wad(2));
    f.oracle.set_ripcord(&true, &f.admin);

    assert!(f.vault.try_fulfill_epoch(&f.manager).is_err());
    assert_eq!(f.vault.current_epoch(), 1);

    f.oracle.set_ripcord(&false, &f.admin);
    assert_eq!(f.vault.fulfill_epoch(&f.manager), 2);
}

#[test]
fn fulfill_is_rejected_once_the_feed_goes_stale() {
    let f = setup();
    f.attest(wad(2));

    f.e.ledger().set_timestamp(10_000 + 3_601);
    assert!(f.oracle.is_stale());
    assert!(f.vault.try_fulfill_epoch(&f.manager).is_err());
    assert_eq!(f.vault.current_epoch(), 1);
}

#[test]
fn the_epoch_is_struck_at_the_attested_price() {
    let f = setup();
    f.attest(3 * WAD_SCALE / 2);

    f.vault.fulfill_epoch(&f.manager);

    assert_eq!(
        f.vault.get_epoch(&1).unwrap().share_price,
        3 * WAD_SCALE / 2
    );
    assert_eq!(f.oracle.nav_per_share(), 3 * WAD_SCALE / 2);
}

#[test]
fn fulfilling_needs_the_manager_authorisation() {
    let f = setup();

    f.attest(wad(2));
    f.e.set_auths(&[]);
    assert!(f.vault.try_fulfill_epoch(&f.manager).is_err());
    assert_eq!(f.vault.current_epoch(), 1);
}

#[test]
fn test_user_can_claim_deposit_and_receive_shares() {
    let f = setup();
    let user = f.investor(1_000);

    f.vault.request_deposit(&user, &400);
    f.strike(wad(2));

    assert_eq!(f.vault.claim_deposit(&user, &1), 200);

    assert_eq!(f.shares(&user), 200);
    assert!(f.vault.get_deposit_request(&1, &user).unwrap().claimed);
    assert_eq!(f.balance(&f.vault.address), 400);
}

#[test]
#[should_panic(expected = "#6035")]
fn test_cannot_claim_twice() {
    let f = setup();
    let user = f.investor(1_000);

    f.vault.request_deposit(&user, &400);
    f.strike(wad(2));

    f.vault.claim_deposit(&user, &1);
    f.vault.claim_deposit(&user, &1);
}

#[test]
fn claiming_an_unfulfilled_epoch_is_rejected() {
    let f = setup();
    let user = f.investor(1_000);

    f.vault.request_deposit(&user, &400);
    assert!(f.vault.try_claim_deposit(&user, &1).is_err());
    assert_eq!(f.shares(&user), 0);
}

#[test]
fn claiming_without_a_request_is_rejected() {
    let f = setup();
    let stranger = Address::generate(&f.e);

    f.strike(wad(2));
    assert!(f.vault.try_claim_deposit(&stranger, &1).is_err());
}

#[test]
fn a_deposit_below_one_share_cannot_be_claimed() {
    let f = setup();
    let user = f.investor(1_000);

    f.vault.request_deposit(&user, &1);
    f.strike(wad(2));

    assert!(f.vault.try_claim_deposit(&user, &1).is_err());
    assert!(!f.vault.get_deposit_request(&1, &user).unwrap().claimed);
}

#[test]
fn claiming_needs_the_investor_authorisation() {
    let f = setup();
    let user = f.investor(1_000);

    f.vault.request_deposit(&user, &400);
    f.strike(wad(2));

    f.e.set_auths(&[]);
    assert!(f.vault.try_claim_deposit(&user, &1).is_err());
}

#[test]
fn a_paused_vault_still_lets_investors_claim() {
    let f = setup();
    let user = f.investor(1_000);

    f.vault.request_deposit(&user, &400);
    f.strike(wad(2));
    f.vault.pause(&f.admin);

    assert_eq!(f.vault.claim_deposit(&user, &1), 200);
    assert_eq!(f.shares(&user), 200);
}

#[test]
fn claims_are_scoped_to_their_own_epoch() {
    let f = setup();
    let user = f.investor(1_000);

    f.vault.request_deposit(&user, &400);
    f.strike(wad(2));
    f.vault.request_deposit(&user, &300);
    f.strike(wad(3));

    assert_eq!(f.vault.claim_deposit(&user, &1), 200);
    assert_eq!(f.vault.claim_deposit(&user, &2), 100);
    assert_eq!(f.shares(&user), 300);
}

#[test]
fn a_non_allowlisted_investor_cannot_claim_shares() {
    let f = setup();
    let stranger = f.unverified_investor(1_000);

    f.vault.request_deposit(&stranger, &400);
    f.strike(wad(2));

    assert!(f.vault.try_claim_deposit(&stranger, &1).is_err());
    assert_eq!(f.shares(&stranger), 0);
    assert!(!f.vault.get_deposit_request(&1, &stranger).unwrap().claimed);
    assert_eq!(f.balance(&f.vault.address), 400);
}

#[test]
fn allowlisting_after_the_fact_lets_the_claim_through() {
    let f = setup();
    let investor = f.unverified_investor(1_000);

    f.vault.request_deposit(&investor, &400);
    f.strike(wad(2));
    assert!(f.vault.try_claim_deposit(&investor, &1).is_err());

    f.identity.allow(&investor, &true, &f.admin);

    assert_eq!(f.vault.claim_deposit(&investor, &1), 200);
    assert_eq!(f.shares(&investor), 200);
}

#[test]
fn the_vault_holds_the_manager_role_on_the_share_token() {
    let f = setup();
    assert!(f
        .share
        .has_role(&f.vault.address, &symbol_short!("manager"))
        .is_some());
}

#[test]
fn a_fractional_share_price_is_representable() {
    let f = setup();
    let user = f.investor(1_000);

    f.vault.request_deposit(&user, &400);
    f.strike(3 * WAD_SCALE / 2);

    assert_eq!(f.vault.claim_deposit(&user, &1), 266);
    assert_eq!(f.shares(&user), 266);
}

#[test]
fn conversion_rounds_down_in_the_vaults_favour() {
    let f = setup();
    let user = f.investor(1_000);

    f.vault.request_deposit(&user, &401);
    f.strike(wad(2));

    assert_eq!(f.vault.claim_deposit(&user, &1), 200);
    assert_eq!(f.balance(&f.vault.address), 401);
}

#[test]
fn a_deposit_too_large_for_an_i128_product_still_converts() {
    let f = setup();
    let whale = f.investor(i128::MAX);
    let amount = 10i128.pow(30);

    f.vault.request_deposit(&whale, &amount);
    f.strike(wad(2));

    assert!(amount.checked_mul(WAD_SCALE).is_none());
    assert_eq!(f.vault.claim_deposit(&whale, &1), 5 * 10i128.pow(29));
}

#[test]
fn a_conversion_that_cannot_fit_i128_is_rejected() {
    let f = setup();
    let whale = f.investor(i128::MAX);

    f.vault.request_deposit(&whale, &(i128::MAX / 2));
    f.strike(1);

    assert!(f.vault.try_claim_deposit(&whale, &1).is_err());
    assert!(!f.vault.get_deposit_request(&1, &whale).unwrap().claimed);
}

#[test]
fn test_request_redeem_locks_shares_and_updates_epoch() {
    let f = setup();
    let user = f.holder(500);
    let epoch = f.vault.current_epoch();

    assert_eq!(f.shares(&user), 500);
    assert_eq!(f.vault.request_redeem(&user, &200), epoch);

    assert_eq!(f.shares(&user), 300);
    assert_eq!(f.shares(&f.vault.address), 200);

    assert_eq!(
        f.vault.get_epoch(&epoch).unwrap().total_shares_redeeming,
        200
    );

    let user_req = f.vault.get_redeem_request(&epoch, &user).unwrap();
    assert_eq!(user_req.shares, 200);
    assert!(!user_req.claimed);
}

#[test]
fn a_delisted_holder_can_still_queue_an_exit() {
    let f = setup();
    let user = f.holder(500);
    let epoch = f.vault.current_epoch();

    f.identity.allow(&user, &false, &f.admin);

    assert_eq!(f.vault.request_redeem(&user, &200), epoch);
    assert_eq!(f.shares(&f.vault.address), 200);
}

#[test]
fn a_paused_vault_still_takes_redeem_requests() {
    let f = setup();
    let user = f.holder(500);
    let epoch = f.vault.current_epoch();

    f.vault.pause(&f.admin);

    assert_eq!(f.vault.request_redeem(&user, &200), epoch);
    assert_eq!(f.shares(&f.vault.address), 200);
}

#[test]
fn request_redeem_rejects_a_non_positive_amount() {
    let f = setup();
    let user = f.holder(500);

    assert!(f.vault.try_request_redeem(&user, &0).is_err());
    assert!(f.vault.try_request_redeem(&user, &-1).is_err());
    assert_eq!(f.shares(&user), 500);
}

#[test]
fn a_second_redeem_request_in_the_same_epoch_is_rejected() {
    let f = setup();
    let user = f.holder(500);

    f.vault.request_redeem(&user, &200);
    assert!(f.vault.try_request_redeem(&user, &100).is_err());
    assert_eq!(f.shares(&user), 300);
}

#[test]
fn request_redeem_needs_the_holder_authorisation() {
    let f = setup();
    let user = f.holder(500);

    f.e.set_auths(&[]);
    assert!(f.vault.try_request_redeem(&user, &200).is_err());
    assert_eq!(f.shares(&user), 500);
}

#[test]
fn redeeming_more_shares_than_held_is_rejected() {
    let f = setup();
    let user = f.holder(500);

    assert!(f.vault.try_request_redeem(&user, &501).is_err());
    assert_eq!(f.shares(&user), 500);
}
