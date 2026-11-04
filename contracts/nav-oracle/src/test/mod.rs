mod governance;
mod guards;
mod oracle;

use crate::OracleError;

/// Asserts a call was refused with exactly this error.
pub(crate) fn refused<T: core::fmt::Debug + PartialEq, E: core::fmt::Debug + PartialEq>(
    result: Result<Result<T, E>, Result<soroban_sdk::Error, soroban_sdk::InvokeError>>,
    expected: OracleError,
) {
    assert_eq!(result, Err(Ok(expected.into())));
}

/// Asserts a call failed for lack of a valid signature, or because the callee
/// answers no interface the host can invoke: either way, the host's own
/// refusal of the invocation, not one of the oracle's named errors.
pub(crate) fn missing_auth<T: core::fmt::Debug + PartialEq, E: core::fmt::Debug + PartialEq>(
    result: Result<Result<T, E>, Result<soroban_sdk::Error, soroban_sdk::InvokeError>>,
) {
    use soroban_sdk::xdr::{ScErrorCode, ScErrorType};
    assert_eq!(
        result,
        Err(Ok(soroban_sdk::Error::from_type_and_code(
            ScErrorType::Context,
            ScErrorCode::InvalidAction
        )))
    );
}
