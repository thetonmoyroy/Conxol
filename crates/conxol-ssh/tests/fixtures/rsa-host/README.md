Synthetic 2048-bit RSA public key and PKCS#1 v1.5 SHA-256/SHA-512 signatures generated locally with OpenSSL for the included message. The temporary private key was discarded; no real host data or credentials are included.

The signed message intentionally retains the original MobaRust spelling: changing any signed byte would invalidate these immutable verification vectors.

The rsa1024-* vectors use a disposable 1024-bit RSA key and a separate synthetic message. The SHA-1 signature starts with a zero byte to exercise legal shortened SSH encoding. SHA-256/SHA-512 signatures use the same message. Only public keys, messages and signatures are retained.

The rsa512-* and rsa768-* vectors were generated with temporary OpenSSL keys, which were discarded. Each size has a separate synthetic message and a SHA-1 signature beginning with zero to test shortened SSH encoding. SHA-256 is included for both sizes; SHA-512 is included only for 768 bits because its DigestInfo and PKCS#1 padding cannot fit a 512-bit modulus. No private key is retained.
