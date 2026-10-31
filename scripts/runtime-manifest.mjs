export const linuxRuntimes = {
  node: {
    version: "24.22.2",
    fileName: "node-v24.22.2-linux-x64.tar.xz",
    url: "https://nodejs.org/download/release/v24.22.2/node-v24.22.2-linux-x64.tar.xz",
    sha256: "48cc0e21e048790e54c0cf5749c2725005313d652651c40b7a21feb9697aaf75",
    extractedDirectory: "node-v24.22.2-linux-x64",
  },
  python: {
    version: "3.12.16",
    build: "20261026",
    fileName: "cpython-3.12.16+20261026-x86_64-unknown-linux-gnu-install_only_stripped.tar.gz",
    url: "https://releases.astral.sh/github/python-build-standalone/releases/download/20261026/cpython-3.12.16%2B20261026-x86_64-unknown-linux-gnu-install_only_stripped.tar.gz",
    sha256: "ce4f6d0a6cfdb3bed6e44c2f9affd85943c76a42e25ad3a259002f31d6fb8a20",
    extractedDirectory: "python",
  },
};

export const runtimeList = Object.values(linuxRuntimes);
