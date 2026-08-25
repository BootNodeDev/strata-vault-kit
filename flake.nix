{
  description = "open-rwa-vault devshell — Soroban (Rust + stellar-cli)";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-26.05";
  };

  outputs =
    { self, nixpkgs }:
    let
      # stellar-cli prebuilt tarball (nixpkgs has no package). Pinned to v27.0.0,
      # same hashes as the sibling `stellar` repo flake.
      cliVersion = "27.0.0";
      cliAssets = {
        x86_64-darwin = {
          target = "x86_64-apple-darwin";
          hash = "sha256-Em3lTANNL9LpAsYanodwS8OMIPkWsXJ+qnh7aYjwkpY=";
        };
        aarch64-darwin = {
          target = "aarch64-apple-darwin";
          hash = "sha256-cKJZ0QU0JZZWtj/nBzEW7DvaDOg4OcnHI2R1BhS+6uY=";
        };
        x86_64-linux = {
          target = "x86_64-unknown-linux-gnu";
          hash = "sha256-NXv3EvY1PCjNM8eUQCo8hyMXV6WzBebvFgQ2WvT91VY=";
        };
        aarch64-linux = {
          target = "aarch64-unknown-linux-gnu";
          hash = "sha256-o0GtzBUuGGXqYdbDMudbPYKx8vMhCBmPrJfFCHixcDQ=";
        };
      };
      systems = builtins.attrNames cliAssets;
      forAllSystems = f: nixpkgs.lib.genAttrs systems (system: f system nixpkgs.legacyPackages.${system});

      mkStellarCli =
        system: pkgs:
        let
          asset = cliAssets.${system};
        in
        pkgs.stdenvNoCC.mkDerivation {
          pname = "stellar-cli";
          version = cliVersion;
          src = pkgs.fetchurl {
            url = "https://github.com/stellar/stellar-cli/releases/download/v${cliVersion}/stellar-cli-${cliVersion}-${asset.target}.tar.gz";
            inherit (asset) hash;
          };
          sourceRoot = ".";
          nativeBuildInputs = pkgs.lib.optionals pkgs.stdenv.isLinux [ pkgs.autoPatchelfHook ];
          buildInputs = pkgs.lib.optionals pkgs.stdenv.isLinux [
            pkgs.stdenv.cc.cc.lib
            pkgs.openssl
            pkgs.zlib
          ];
          installPhase = "runHook preInstall; install -Dm755 stellar $out/bin/stellar; runHook postInstall";
          meta.mainProgram = "stellar";
        };
    in
    {
      packages = forAllSystems (
        system: pkgs: {
          stellar-cli = mkStellarCli system pkgs;
          default = mkStellarCli system pkgs;
        }
      );

      devShells = forAllSystems (
        system: pkgs: {
          default = pkgs.mkShell {
            packages = [
              # Soroban / Rust
              pkgs.rustup # honors ./rust-toolchain.toml (stable + wasm32v1-none + rust-src)
              (mkStellarCli system pkgs)
              pkgs.wabt # wasm2wat / wasm-objdump
              pkgs.twiggy # wasm size profiler
              pkgs.cargo-nextest
              pkgs.cargo-llvm-cov # line/region coverage (needs llvm-tools-preview)
              # Formal methods
              pkgs.tlaplus # tlc + pcal (TLA+ / PlusCal)
            ];

            shellHook = ''
              rustup show >/dev/null 2>&1 || true
              echo "open-rwa-vault devshell"
              echo "  stellar: $(stellar --version 2>/dev/null | head -1)"
              echo "  rust:    $(rustc --version 2>/dev/null || echo '(run any cargo/rustc to trigger rustup)')"
              echo "  tla:     $(tlc 2>&1 | head -1 | sed 's/^/           /' | xargs echo | cut -c1-60)  (tlc + pcal)"
              echo "  loop:    pcal spec/Token.tla -> tlc -config spec/Token.cfg spec/Token.tla"
            '';
          };
        }
      );
    };
}
