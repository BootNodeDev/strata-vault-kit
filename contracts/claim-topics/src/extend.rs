//! OpenZeppelin extends an entry when it reads it, not when it creates it.

use soroban_sdk::{Address, Env};
use stellar_tokens::rwa::identity_verification::claim_topics_and_issuers::storage;

/// Reads the topic list and the topic's issuer list an added topic wrote.
pub(crate) fn topic(e: &Env, topic: u32) {
    storage::get_claim_topics(e);
    storage::get_claim_topic_issuers(e, topic);
}

/// Reads the issuer list and the issuer's topic list an added issuer wrote.
pub(crate) fn issuer(e: &Env, issuer: &Address) {
    storage::get_trusted_issuers(e);
    storage::get_trusted_issuer_claim_topics(e, issuer);
}
