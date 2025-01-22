const path = require("path");
const webpack = require("webpack");

module.exports = {
    mode: "production",
    entry: "./build/src/signatureoffloader/signatureOffloader-worker.js",
    output: {
        path: path.resolve(__dirname, "build/src/signatureoffloader"),
        filename: "./signatureOffloader-worker-browser.js",
        pathinfo: true,
        library: {
            type: "umd",
            name: "add",
        }
    },
    resolve: {
        alias: {
            "fs": false,
            "http": false,
            "os": false,
            "net": false,
            "tls": false,
            "https": false,
            "sqlite3": false,
            "postgrejs": false
        },
        extensions: [".tsx", ".ts", ".js"],
        fallback: {
            crypto: require.resolve("crypto-browserify"),
            path:   require.resolve("path-browserify"),
            stream: require.resolve("stream-browserify"),
            vm:     require.resolve("vm-browserify"),
            buffer: require.resolve("buffer/")
        }
    },
    module: {
          noParse: /\/node_modules\/process\//,
    },
    plugins: [
          new webpack.ProvidePlugin({
              process: "process/browser.js",
          }),
          new webpack.DefinePlugin({
              process: {
                  env: {
                      "process.env.NODE_ENV" : JSON.stringify("production")
                  }
              }
        }),
        new webpack.ProvidePlugin({
            Buffer: ["buffer", "Buffer"],
        }),
    ]
};
