-- Installed only inside the initial-import transaction, after workbook equality.
CREATE ROLE amal_seed_owner NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;
CREATE ROLE amal_app NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;
CREATE SCHEMA seed_guard AUTHORIZATION amal_seed_owner;
CREATE FUNCTION seed_guard.reject_write() RETURNS trigger LANGUAGE plpgsql
SET search_path = pg_catalog AS $$
BEGIN
  RAISE EXCEPTION 'Immutable workbook seed: % is forbidden', TG_OP USING ERRCODE = '42501';
END;
$$;
ALTER FUNCTION seed_guard.reject_write() OWNER TO amal_seed_owner;
REVOKE ALL ON SCHEMA seed_guard FROM PUBLIC;
REVOKE ALL ON FUNCTION seed_guard.reject_write() FROM PUBLIC;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO amal_app;
