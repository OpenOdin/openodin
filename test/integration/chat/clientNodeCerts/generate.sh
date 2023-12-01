#!/usr/bin/env sh

CERT="../../../../src/sdk/tools/cert"

set -e

# Create empty constraints.json files so that they exist, of not already.
if [ ! -s "dataCertConstraints.json" ]; then
    echo "{}" >"dataCertConstraints.json"
fi

if [ ! -s "licenseCertConstraints.json" ]; then
    echo "{}" >"licenseCertConstraints.json"
fi

${CERT} create dataCertParams.json --keyFile=../clientAuthCert/clientKeyfileOwner.json >dataCert.json

${CERT} create licenseCertParams.json --keyFile=../clientAuthCert/clientKeyfileOwner.json >licenseCert.json
