#!/usr/bin/env sh

# Test creating a multisig cert.
# Signing a cert multiple times is managed by exporting the cert to its clear text params state,
# then feeding those params back into the `cert` program to sign it with the next key.
#

CERT="../../../cert"

set -e

# Create the multisig chain cert.
${CERT} create chainCertParams.json --keyFile=keyFileIssuer.json >tmpChainCert.json

# Verify it
${CERT} verify tmpChainCert.json

# Create auth cert with this multisig chain cert, but do not sign it here.
${CERT} create auth/authCertParams.json >tmpAuthCert1.json

# Export the cert back into its params state, so we can feed it back to the cert utility to sign it.
${CERT} export tmpAuthCert1.json >tmpAuthCertParams1.json

# Sign with the first key.
${CERT} create tmpAuthCertParams1.json --keyFile=auth/keyFileA.json >tmpAuthCert2.json

# Export the cert back into its params state, so we can feed it back to the cert utility to sign it again.
${CERT} export tmpAuthCert2.json >tmpAuthCertParams2.json

# Sign with the second key to finalize the cert.
# tmpAuthCert.json is the actual cert which would be used to authenticate.
${CERT} create tmpAuthCertParams2.json --keyFile=auth/keyFileB.json >tmpAuthCert.json

# Verify it
${CERT} verify tmpAuthCert.json

# Export the verified cert back into its params state so we can see the parameters.
${CERT} export tmpAuthCert.json >tmpAuthCertParams.json
