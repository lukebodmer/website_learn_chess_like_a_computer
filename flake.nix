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
	      pkgs.typescript
	      pkgs.nodejs_24
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
                numpy
		scipy
		psycopg2
		pycountry
		pytz
		zstandard
              #  matplotlib
              ]))
            ];

            # ENVIRONMENT_VARIABLE_EXAMPLE = "${pkgs.hello-nix}";

            shellHook = ''
              export VIRTUAL_ENV="LCLC website"

              # PostgreSQL configuration
              export PGDATA="$PWD/postgres_data"
              export PGHOST="$PWD/postgres_data"
              export PGPORT="5432"
              export PGDATABASE="chess_analysis"
	      echo python manage.py runserver to start Django server
              echo pg_ctl start to start database
	      echo npm build run to rebuild javascript
            '';
          };
        };
}
