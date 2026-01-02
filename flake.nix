{
  description = "Description for the project";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    custom-nixpkgs.url = "github:lukebodmer/custom_nixpkgs";
  };

  outputs = { nixpkgs, custom-nixpkgs, ... }:
      let
        system = "x86_64-linux";
        pkgs = import nixpkgs {
          inherit system;
          overlays = [ custom-nixpkgs.overlays.default ];
        };

	# Choose a specific Python version for all packages
	python = pkgs.python312;

      in
        {
          devShells.${system}.default = pkgs.mkShell {
            name = "default";
               
            packages = [
            # General packages
              # pkgs.hello-nix
	      pkgs.stockfish
	      pkgs.postgresql
	      pkgs.zstd

            # Python packages
              (python.withPackages (ps: with ps; [
              #  # packages for formatting/ IDE
                python-lsp-server
	      #  pyls-flake8
                flake8

              #  # packages for code
		chess
		chess_com
		django
		djangorestframework
		flask
		requests
		pycountry
		psycopg2
              #  matplotlib
              #  numpy
              ]))
            ];

            # ENVIRONMENT_VARIABLE_EXAMPLE = "${pkgs.hello-nix}";

            shellHook = ''
              export VIRTUAL_ENV="Custom Environment"

              # PostgreSQL configuration
              export PGDATA="$PWD/postgres_data"
              export PGHOST="$PWD/postgres_data"
              export PGPORT="5433"
              export PGDATABASE="chess_analysis"
            '';
          };
        };
}
