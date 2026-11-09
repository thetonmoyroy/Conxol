//! Public-only verification for legacy SSH RSA host keys below 1024 bits.
//! The high-level AWS-LC verifier deliberately exposes a 1024-bit minimum.
//! Keep this narrow compatibility path separate from private-key operations.
use ssh_key::{Algorithm, HashAlg};

pub(super) fn verify(
    n: &[u8],
    e: &[u8],
    algorithm: &Algorithm,
    message: &[u8],
    signature: &[u8],
) -> bool {
    use aws_lc_rs::digest::{SHA1_FOR_LEGACY_USE_ONLY, SHA256, SHA512, digest};
    use aws_lc_sys::{BN_bin2bn, BN_free, RSA_free, RSA_new_public_key, RSA_verify};

    let bits = n
        .first()
        .map_or(0, |first| n.len() * 8 - first.leading_zeros() as usize);
    // Bound peer-controlled allocations and public exponent work. No general
    // "large exponent" constructor, raw RSA, or relaxed PKCS#1 padding checks.
    if !(512..1024).contains(&bits) || e.is_empty() || e.len() > 5 || signature.len() != n.len() {
        return false;
    }
    let (hash, nid) = match algorithm {
        Algorithm::Rsa { hash: None } => (&SHA1_FOR_LEGACY_USE_ONLY, aws_lc_sys::NID_sha1),
        Algorithm::Rsa {
            hash: Some(HashAlg::Sha256),
        } => (&SHA256, aws_lc_sys::NID_sha256),
        Algorithm::Rsa {
            hash: Some(HashAlg::Sha512),
        } => (&SHA512, aws_lc_sys::NID_sha512),
        _ => return false,
    };
    let digest = digest(hash, message);
    // SAFETY: all inputs are bounded, live slices with their exact lengths.
    // Each allocated BIGNUM is checked and freed on every path. The public-key
    // constructor copies n/e; RSA_free owns only its resulting RSA object.
    // RSA_verify checks the full ASN.1 DigestInfo and PKCS#1 v1.5 padding.
    unsafe {
        let modulus = BN_bin2bn(n.as_ptr(), n.len(), std::ptr::null_mut());
        if modulus.is_null() {
            return false;
        }
        let exponent = BN_bin2bn(e.as_ptr(), e.len(), std::ptr::null_mut());
        if exponent.is_null() {
            BN_free(modulus);
            return false;
        }
        let public = RSA_new_public_key(modulus, exponent);
        BN_free(exponent);
        BN_free(modulus);
        if public.is_null() {
            return false;
        }
        let valid = RSA_verify(
            nid,
            digest.as_ref().as_ptr(),
            digest.as_ref().len(),
            signature.as_ptr(),
            signature.len(),
            public,
        ) == 1;
        RSA_free(public);
        valid
    }
}
