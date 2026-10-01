#![no_std]
mod contract;
mod error;
mod roles;
pub use contract::*;
pub use error::ShareTokenError;

#[cfg(test)]
mod test;
