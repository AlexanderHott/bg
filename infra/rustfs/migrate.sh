#!/bin/sh
# One-shot copy of the pre-RustFS MinIO bucket into RustFS. Safe to re-run: existing objects are skipped.
set -eu

rc alias set rustfs "$RUSTFS_ENDPOINT" "$RUSTFS_ACCESS_KEY" "$RUSTFS_SECRET_KEY" >/dev/null
rc alias set legacy "$LEGACY_ENDPOINT" "$RUSTFS_ACCESS_KEY" "$RUSTFS_SECRET_KEY" >/dev/null

tries=0
until rc ls "legacy/$RUSTFS_BUCKET" >/dev/null 2>&1
do
  tries=$((tries + 1))
  if [ "$tries" -ge 120 ]; then
    echo "legacy MinIO never became reachable" >&2
    exit 1
  fi
  sleep 1
done

rc mirror --no-progress "legacy/$RUSTFS_BUCKET" "rustfs/$RUSTFS_BUCKET"
echo "legacy objects: $(rc ls --recursive "legacy/$RUSTFS_BUCKET" | wc -l)"
echo "rustfs objects: $(rc ls --recursive "rustfs/$RUSTFS_BUCKET" | wc -l)"
