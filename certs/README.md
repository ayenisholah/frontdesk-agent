# Public RDS trust bundle

`rds-eu-west-1.crt` contains public CA certificates, not a private key or credential.

Source: https://truststore.pki.rds.amazonaws.com/eu-west-1/eu-west-1-bundle.pem
Retrieved: 2026-11-06
SHA-256: `a11cf9a1d0aadd7db86f92cbaa496466daeb501bf1c5e429d8ce8914a01c15d6`

The certificate test verifies all three roots are self-signed CA certificates and
unexpired. Review AWS RDS CA changes before deployment; update this bundle from
the official source, review fingerprints and rerun the image checks when needed.
