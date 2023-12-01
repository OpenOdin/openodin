#!/usr/bin/env sh

CERT="../../../../src/sdk/tools/cert"

set -e

# Create empty constraints.json files so that they exist, of not already.
if [ ! -s "constraints.json" ]; then
    echo "{}" >"constraints.json"
fi

${CERT} create authCertParams.json --keyFile=clientKeyfileOwner.json >authcert.json
