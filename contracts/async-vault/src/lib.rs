//! Async request lifecycle for the vault: subscriptions and redemptions are
//! registered, priced by an attestation, and claimed afterwards.
//!
//! This crate is a skeleton. The storage model, the accounting and the
//! entrypoints arrive with the issues that build on it.
#![no_std]

use soroban_sdk::contract;

#[contract]
pub struct AsyncVault;

#[cfg(test)]
mod test;
