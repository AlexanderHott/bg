#!/bin/sh
set -eu

alias_name="local"

until rc alias set \
  "$alias_name" \
  "$RUSTFS_ENDPOINT" \
  "$RUSTFS_ACCESS_KEY" \
  "$RUSTFS_SECRET_KEY" >/dev/null 2>&1 &&
  rc ping "$alias_name" >/dev/null 2>&1
do
  sleep 1
done

rc bucket create --ignore-existing "$alias_name/$RUSTFS_BUCKET"
