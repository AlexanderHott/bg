#!/bin/sh
set -eu

alias_name="local"

until mc alias set \
  "$alias_name" \
  "$MINIO_ENDPOINT" \
  "$MINIO_ROOT_USER" \
  "$MINIO_ROOT_PASSWORD" >/dev/null 2>&1
do
  sleep 1
done

bucket="$alias_name/$MINIO_BUCKET"

mc mb --ignore-existing "$bucket"
mc anonymous set none "$bucket"
