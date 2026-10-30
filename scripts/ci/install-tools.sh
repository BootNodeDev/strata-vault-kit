#!/usr/bin/env bash
# Installs pinned x86_64 Linux release binaries after checking each archive's SHA-256.
set -euo pipefail

STELLAR_CLI_VERSION=27.0.0
STELLAR_CLI_SHA256=357bf712f6353c28cd33c794402a3c87231757a5b305e6ef1604365af4fdd556
STELLAR_SCAFFOLD_VERSION=0.0.27
STELLAR_SCAFFOLD_SHA256=f24709de57e33155efd72547c9286b522d4360a379bde5af9eeb5519396f10cc
GITLEAKS_VERSION=8.30.1
GITLEAKS_SHA256=551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb

bin_dir="${INSTALL_DIR:-$HOME/.local/bin}"
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

install_binary() {
	local url=$1 sha256=$2 binary=$3 archive="$work/$3.tar.gz"
	curl -fsSL --retry 3 -o "$archive" "$url"
	if ! echo "$sha256  $archive" | sha256sum --check --strict --status; then
		echo "$url does not match its pinned SHA-256; nothing installed." >&2
		exit 1
	fi
	tar -xzf "$archive" -C "$work" "$binary"
	install -Dm755 "$work/$binary" "$bin_dir/$binary"
	echo "installed $binary from $url"
}

[ $# -gt 0 ] || { echo "usage: $0 stellar|stellar-scaffold|gitleaks..." >&2; exit 2; }
for tool in "$@"; do
	case "$tool" in
	stellar) install_binary "https://github.com/stellar/stellar-cli/releases/download/v$STELLAR_CLI_VERSION/stellar-cli-$STELLAR_CLI_VERSION-x86_64-unknown-linux-gnu.tar.gz" "$STELLAR_CLI_SHA256" stellar ;;
	stellar-scaffold) install_binary "https://github.com/stellar-scaffold/cli/releases/download/stellar-scaffold-cli-v$STELLAR_SCAFFOLD_VERSION/stellar-scaffold-cli-v$STELLAR_SCAFFOLD_VERSION-x86_64-unknown-linux-gnu.tar.gz" "$STELLAR_SCAFFOLD_SHA256" stellar-scaffold ;;
	gitleaks) install_binary "https://github.com/gitleaks/gitleaks/releases/download/v$GITLEAKS_VERSION/gitleaks_${GITLEAKS_VERSION}_linux_x64.tar.gz" "$GITLEAKS_SHA256" gitleaks ;;
	*) echo "unknown tool: $tool" >&2; exit 2 ;;
	esac
done
if [ -n "${GITHUB_PATH:-}" ]; then echo "$bin_dir" >>"$GITHUB_PATH"; fi
