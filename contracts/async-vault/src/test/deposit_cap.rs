use super::*;

#[test]
fn deposit_cap_defaults_to_none_unbounded() {
    let f = setup();
    assert_eq!(f.vault.deposit_cap(), None);
    assert_eq!(f.vault.total_economic_assets(), 0);

    let investor = f.investor(50_000);
    f.vault.request_deposit(&investor, &50_000);
    assert_eq!(f.vault.total_economic_assets(), 50_000);
}

#[test]
fn governance_sets_updates_and_clears_cap() {
    let f = setup();

    // Set cap
    f.vault.set_deposit_cap(&Some(1_000), &f.admin);
    assert_eq!(f.vault.deposit_cap(), Some(1_000));

    // Update cap
    f.vault.set_deposit_cap(&Some(2_000), &f.admin);
    assert_eq!(f.vault.deposit_cap(), Some(2_000));

    // Clear cap
    f.vault.set_deposit_cap(&None, &f.admin);
    assert_eq!(f.vault.deposit_cap(), None);
}

#[test]
fn negative_cap_rejected() {
    let f = setup();
    refused(
        f.vault.try_set_deposit_cap(&Some(-1), &f.admin),
        VaultError::InvalidAmount,
    );
}

#[test]
fn unauthorized_caller_rejected() {
    let f = setup();
    let rando = Address::generate(&f.e);

    f.e.set_auths(&[]);
    assert!(f.vault.try_set_deposit_cap(&Some(1_000), &rando).is_err());
    assert!(f
        .vault
        .try_set_deposit_cap(&Some(1_000), &f.manager)
        .is_err());
    assert!(f
        .vault
        .try_set_deposit_cap(&Some(1_000), &f.guardian)
        .is_err());
    assert!(f
        .vault
        .try_set_deposit_cap(&Some(1_000), &f.treasury)
        .is_err());
}

#[test]
fn boundary_value_enforcement() {
    let f = setup();
    f.vault.set_deposit_cap(&Some(1_000), &f.admin);

    let investor1 = f.investor(2_000);
    let investor2 = f.investor(2_000);

    // Deposit exceeding cap from empty vault fails
    refused(
        f.vault.try_request_deposit(&investor1, &1_001),
        VaultError::DepositCapExceeded,
    );

    // Deposit exactly equal to cap succeeds
    f.vault.request_deposit(&investor1, &1_000);
    assert_eq!(f.vault.total_economic_assets(), 1_000);

    // Any subsequent deposit fails
    refused(
        f.vault.try_request_deposit(&investor2, &1),
        VaultError::DepositCapExceeded,
    );
}

#[test]
fn cancellation_frees_capacity() {
    let f = setup();
    f.vault.set_deposit_cap(&Some(1_000), &f.admin);

    let investor1 = f.investor(1_000);
    let investor2 = f.investor(1_000);

    let epoch_id = f.vault.request_deposit(&investor1, &1_000);
    assert_eq!(f.vault.total_economic_assets(), 1_000);

    // Blocked while request is pending
    refused(
        f.vault.try_request_deposit(&investor2, &500),
        VaultError::DepositCapExceeded,
    );

    // Cancel refund restores capacity
    f.vault.cancel_deposit(&investor1, &epoch_id);
    assert_eq!(f.vault.total_economic_assets(), 0);

    // Now investor2 can deposit
    f.vault.request_deposit(&investor2, &500);
    assert_eq!(f.vault.total_economic_assets(), 500);
}

#[test]
fn deployed_capital_and_multi_epoch_accounting() {
    let f = setup();
    f.vault.set_deposit_cap(&Some(1_000), &f.admin);

    let investor1 = f.investor(1_000);
    let investor2 = f.investor(1_000);

    // Epoch 1 deposit
    f.vault.request_deposit(&investor1, &1_000);
    f.vault.close_epoch(&f.manager);
    f.attest(wad(1));
    f.vault.fulfill_epoch(&1);

    // Deploy 800 to custodian
    f.vault.set_custodian(&f.custodian, &f.admin);
    f.vault.deploy_to_custodian(&f.treasury, &800);
    assert_eq!(f.vault.net_deployed(), 800);
    assert_eq!(f.vault.total_economic_assets(), 1_000);

    // In Epoch 2, deposit of 1 still breaches cap
    refused(
        f.vault.try_request_deposit(&investor2, &1),
        VaultError::DepositCapExceeded,
    );

    // Governance raises cap to 1_500
    f.vault.set_deposit_cap(&Some(1_500), &f.admin);

    // Now investor2 can deposit 500
    f.vault.request_deposit(&investor2, &500);
    assert_eq!(f.vault.total_economic_assets(), 1_500);
}

#[test]
fn redemptions_free_capacity() {
    let f = setup();
    f.vault.set_deposit_cap(&Some(1_000), &f.admin);

    let investor1 = f.investor(1_000);
    let investor2 = f.investor(1_000);

    // Epoch 1: investor1 deposits 1_000 and claims 1_000 shares
    f.vault.request_deposit(&investor1, &1_000);
    f.vault.close_epoch(&f.manager);
    f.attest(wad(1));
    f.vault.fulfill_epoch(&1);
    f.vault.claim_deposit(&investor1, &1);

    // In Epoch 2, total_economic_assets is 1_000, so new deposit of 500 fails
    refused(
        f.vault.try_request_deposit(&investor2, &500),
        VaultError::DepositCapExceeded,
    );

    // Investor 1 requests redemption of 500 shares
    f.vault.request_redeem(&investor1, &500);
    f.vault.close_epoch(&f.manager);
    f.attest(wad(1));
    f.vault.fulfill_epoch(&2);

    // Redemption is now priced and committed (500 committed to exit)
    assert_eq!(f.vault.committed(), 500);
    assert_eq!(f.vault.total_economic_assets(), 500);

    // In Epoch 3, headroom has opened up, so investor2 can deposit 500
    f.vault.request_deposit(&investor2, &500);
    assert_eq!(f.vault.total_economic_assets(), 1_000);
}

#[test]
fn zero_cap_blocks_all_deposits() {
    let f = setup();
    f.vault.set_deposit_cap(&Some(0), &f.admin);

    let investor = f.investor(100);
    refused(
        f.vault.try_request_deposit(&investor, &1),
        VaultError::DepositCapExceeded,
    );
}
