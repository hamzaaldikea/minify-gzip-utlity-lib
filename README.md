# minify-gzip-utlity-lib

This package contains a small Node.js utility for comparing JSON payload size across minification, gzip compression, manual decompression, and a `gaxios` read of a gzipped HTTP response.

The gzip and gunzip steps use zlib's async APIs rather than `gzipSync` and `gunzipSync`. That keeps the utility non-blocking while preserving the current buffered behavior.

This utility is a showcase, not a streaming transport pipeline. It intentionally reads and returns full payloads so it can compare original, minified, gzipped, and decompressed sizes side by side.

When the payload comes through `gaxios`, no manual gunzip step is needed because `gaxios` already returns the decompressed response body when the server responds with `content-encoding: gzip`.

## Run

```bash
node minify-gzip-utlity-lib.js
```

## What It Demonstrates

- Original JSON payload size
- Minified JSON payload size
- Gzipped minified payload size
- Manual async gunzip back to the full JSON string
- `gaxios` automatically returning the decompressed JSON response body

## Current Output

```text
Original file: /Users/hamza.al.darawsheh/Public/ikea/pdpp-core-schedule/minify-gzip-utlity-lib/minify-gzip-utlity-lib-sample-data-2mb.json
Original size: 2,097,515 bytes
Size after minify: 1,635,948 bytes (22.01% reduction)
Size after gzip the minified version: 99,605 bytes (95.25% reduction)
Size after decompressing gzipped minified version: 1,635,948 bytes (22.01% reduction) (there is reduction even after the decompression)
First object after decompressing:
{
  "id": 1,
  "category": "category-1",
  "name": "Sample object 1",
  "active": false,
  "score": 1.618,
  "tags": [
    "tag-1",
    "group-1",
    "batch-1"
  ],
  "metadata": {
    "source": "generated",
    "owner": "owner-1",
    "priority": "medium",
    "checksum": "chk-00000001"
  },
  "description": "This is generated payload item 1 used for gzip and JSON size testing near gzip.js. It contains repeated but structured content to create a predictable file footprint."
}
Size after reading gzipped response with gaxios: 1,635,948 bytes (22.01% reduction) (gaxios returned the decompressed body, so no manual decompression was needed)
First object after reading gzipped response with gaxios:
{
  "id": 1,
  "category": "category-1",
  "name": "Sample object 1",
  "active": false,
  "score": 1.618,
  "tags": [
    "tag-1",
    "group-1",
    "batch-1"
  ],
  "metadata": {
    "source": "generated",
    "owner": "owner-1",
    "priority": "medium",
    "checksum": "chk-00000001"
  },
  "description": "This is generated payload item 1 used for gzip and JSON size testing near gzip.js. It contains repeated but structured content to create a predictable file footprint."
}
```
