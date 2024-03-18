#!/usr/bin/env sh

# Test creating a friend cert pair.
#

CERT="npx cert"

set -e

# Create empty constraints.json files so that they exist, of not already.
if [ ! -s "./certa/constraints.json" ]; then
    echo "{}" >"./certa/constraints.json"
fi

if [ ! -s "./certb/constraints.json" ]; then
    echo "{}" >"./certb/constraints.json"
fi

if [ ! -s "./certself/constraints.json" ]; then
    echo "{}" >"./certself/constraints.json"
fi

${CERT} constraints ./certa/friendCertParams.json ./certa/constraintParams.json >certa/constraints.json

${CERT} constraints ./certb/friendCertParams.json ./certb/constraintParams.json >certb/constraints.json

${CERT} constraints ./certself/friendCertParams.json ./certself/constraintParams.json >certself/constraints2.json

# Since the self cert is depending on its own constraints we had to use a tmp file for constraints.
mv ./certself/constraints2.json ./certself/constraints.json

${CERT} create ./certa/friendCertParams.json --keyFile=certa/keyFileIssuer.json >certa/friendCert.json

${CERT} create ./certb/friendCertParams.json --keyFile=certb/keyFileIssuer.json >certb/friendCert.json

${CERT} create ./certself/friendCertParams.json --keyFile=certself/keyFileIssuer.json >certself/friendCert.json

${CERT} verify ./certa/friendCert.json ./certa/constraintParams.json

${CERT} verify ./certb/friendCert.json ./certb/constraintParams.json

${CERT} verify ./certself/friendCert.json ./certself/constraintParams.json
