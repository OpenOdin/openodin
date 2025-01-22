#!/usr/bin/env sh

CERT="npx ts-node ../../../../src/sdk/tools/src/CertCLI.ts"

set -e

${CERT} create authCertProps.json --keyFile=clientKeyfileOwner.json >authCert.json

${CERT} verify authCert.json

${CERT} create dataCertProps.json --keyFile=clientKeyfileOwner.json >dataCert.json

${CERT} verify dataCert.json

${CERT} create licenseCertProps.json --keyFile=clientKeyfileOwner.json >licenseCert.json

${CERT} verify licenseCert.json
