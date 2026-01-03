#!/usr/bin/env bash

# Setup PostgreSQL database for chess evaluations (Nix version)

set -e

echo "Setting up PostgreSQL database for chess evaluations..."

# Check if PostgreSQL data directory exists
if [ ! -d "$PGDATA" ]; then
    echo "Initializing PostgreSQL data directory at $PGDATA"
    initdb --locale=C --encoding=UTF8
fi

# Configure PostgreSQL to use local socket directory
echo "Configuring PostgreSQL..."
cat >> "$PGDATA/postgresql.conf" << EOF
unix_socket_directories = '$PWD/postgres_data'
port = 5432
EOF

# Start PostgreSQL if not running
if ! pg_ctl status > /dev/null 2>&1; then
    echo "Starting PostgreSQL server..."
    pg_ctl start -l "$PWD/logfile"
    sleep 3
fi

# Create database user and database
echo "Creating database user and database..."
psql -h "$PGHOST" -p "$PGPORT" -d postgres << EOF
DO \$\$
BEGIN
    IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'chess_user') THEN
        CREATE USER chess_user WITH PASSWORD 'chess_password';
    END IF;
END
\$\$;

DROP DATABASE IF EXISTS chess_evaluations;
CREATE DATABASE chess_evaluations OWNER chess_user;
GRANT ALL PRIVILEGES ON DATABASE chess_evaluations TO chess_user;
EOF

echo "PostgreSQL setup completed!"
echo "Database: chess_evaluations"
echo "Host: $PGHOST"
echo "Port: $PGPORT"
echo ""
echo "Next steps:"
echo "1. Dependencies are already installed via Nix"
echo "2. Run migrations: python manage.py migrate --database=evaluations"
echo "3. Import data: python manage.py import_evaluations"
