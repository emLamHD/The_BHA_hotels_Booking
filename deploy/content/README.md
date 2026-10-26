# Website content pack

`bha-site-content/` is the website's content (Riverside catalog, offers, Blog) as rows and picture files, committed so that any database can be given it.
Read `docs/runbooks/BHA-CONTENT-PERSIST-001.md` before using it. `import-content-pack.sh dry-run|apply|verify` runs the API image's `--content-pack-import` / `--content-pack-verify`.
CI imports this pack into a fresh database on every run (`ContentPackTests`).
