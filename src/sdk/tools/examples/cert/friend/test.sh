#!/usr/bin/env sh

# Test creating a friend cert pair.
#

CERT="../../../cert"

set -e

# Create the constraints.json files so that they exist, of not already.
if [ ! -s "./certa/constraints.json" ]; then
    echo "{}" >"./certa/constraints.json"
fi

if [ ! -s "./certb/constraints.json" ]; then
    echo "{}" >"./certb/constraints.json"
fi

${CERT} constraints ./certa/friendCertParams.json ./certa/constraintParams.json >certa/constraints.json

${CERT} constraints ./certb/friendCertParams.json ./certb/constraintParams.json >certb/constraints.json

${CERT} create ./certa/friendCertParams.json --keyFile=certa/keyFileIssuer.json >certa/friendCert.json

${CERT} create ./certb/friendCertParams.json --keyFile=certb/keyFileIssuer.json >certb/friendCert.json

${CERT} verify ./certa/friendCert.json ./certa/constraintParams.json

${CERT} verify ./certb/friendCert.json ./certb/constraintParams.json
