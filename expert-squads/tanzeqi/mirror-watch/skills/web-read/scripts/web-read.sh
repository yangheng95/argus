#!/bin/bash
set -euo pipefail

if [ "$#" -ne 1 ]; then
  echo "Usage: $0 <http(s)-url>" >&2
  exit 1
fi

URL="$1"
case "$URL" in
  http://*|https://*) ;;
  *)
    echo "web-read requires an absolute HTTP(S) URL" >&2
    exit 1
    ;;
esac

curl --fail --silent --show-error --location --max-time 30 "https://r.jina.ai/$URL"
