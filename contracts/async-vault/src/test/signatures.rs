//! What each privileged call asks to sign: one signature per account it needs.

use soroban_sdk::{IntoVal, Vec};

use super::*;

#[test]
fn each_setup_call_asks_the_admin_for_one_signature() {
    let f = setup_unfinished();
    let holder = Address::generate(&f.e);
    let treasury = symbol_short!("treasury");
    let delay = 2 * MIN_WIND_DOWN_DELAY;
    let live_until = f.e.ledger().sequence() + 100;

    f.vault.set_custodian(&f.custodian);
    f.signed_once_by(
        &f.admin,
        "set_custodian",
        (f.custodian.clone(),).into_val(&f.e),
    );
    f.vault.set_notice(&3_600);
    f.signed_once_by(&f.admin, "set_notice", (3_600_u64,).into_val(&f.e));
    f.vault.set_wind_down_delay(&delay);
    f.signed_once_by(&f.admin, "set_wind_down_delay", (delay,).into_val(&f.e));
    f.vault.set_deposit_cap(&Some(1_000));
    f.signed_once_by(
        &f.admin,
        "set_deposit_cap",
        (Some(1_000_i128),).into_val(&f.e),
    );
    f.vault.grant_role(&holder, &treasury, &f.admin);
    f.signed_once_by(
        &f.admin,
        "grant_role",
        (holder.clone(), treasury.clone(), f.admin.clone()).into_val(&f.e),
    );
    f.vault.revoke_role(&holder, &treasury, &f.admin);
    f.signed_once_by(
        &f.admin,
        "revoke_role",
        (holder.clone(), treasury, f.admin.clone()).into_val(&f.e),
    );
    f.vault.transfer_admin_role(&holder, &live_until);
    f.signed_once_by(
        &f.admin,
        "transfer_admin_role",
        (holder.clone(), live_until).into_val(&f.e),
    );
    f.vault.transfer_admin_role(&holder, &0);
    f.signed_once_by(
        &f.admin,
        "transfer_admin_role",
        (holder, 0_u32).into_val(&f.e),
    );
    f.vault.finish_setup();
    f.signed_once_by(&f.admin, "finish_setup", Vec::new(&f.e));
}

#[test]
fn each_admin_call_after_setup_asks_the_admin_for_one_signature() {
    let f = setup();
    let next = Address::generate(&f.e);

    let change = VaultChange::Custodian(next.clone());
    let id = f.vault.propose_change(&change);
    f.signed_once_by(&f.admin, "propose_change", (change,).into_val(&f.e));
    f.vault.cancel_change(&id);
    f.signed_once_by(&f.admin, "cancel_change", (id,).into_val(&f.e));

    let id = f.vault.propose_change(&VaultChange::Admin(next.clone()));
    f.advance(MIN_UPGRADE_DELAY);
    f.vault.apply_change(&id);
    f.signed_once_by(&f.admin, "apply_change", (id,).into_val(&f.e));

    f.vault.pause(&f.guardian);
    f.vault.unpause(&f.admin);
    f.signed_once_by(&f.admin, "unpause", (f.admin.clone(),).into_val(&f.e));

    f.vault.propose_wind_down();
    f.signed_once_by(&f.admin, "propose_wind_down", Vec::new(&f.e));
    f.vault.cancel_wind_down_proposal();
    f.signed_once_by(&f.admin, "cancel_wind_down_proposal", Vec::new(&f.e));

    f.vault.accept_admin_transfer();
    f.signed_once_by(&next, "accept_admin_transfer", Vec::new(&f.e));
}

#[test]
fn each_role_call_asks_its_holder_for_one_signature() {
    let f = setup();
    let investor = f.investor(1_000);
    f.vault.request_deposit(&investor, &400);

    let epoch = f.vault.close_epoch(&f.manager);
    f.signed_once_by(
        &f.manager,
        "close_epoch",
        (f.manager.clone(),).into_val(&f.e),
    );
    f.fulfill_epoch_at(epoch, wad(2));
    let free = f.vault.free_reserve();
    f.vault.deploy_to_custodian(&f.treasury, &free);
    f.signed_once_by(
        &f.treasury,
        "deploy_to_custodian",
        (f.treasury.clone(), free).into_val(&f.e),
    );
    f.vault.pause(&f.guardian);
    f.signed_once_by(&f.guardian, "pause", (f.guardian.clone(),).into_val(&f.e));
}
