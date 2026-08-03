#!/bin/sh
# Wait for the in-flight level-6 feat axis, then run both axes at level 20, archiving between.
# Sequential because Foundry locks its data directory — two instances cannot run at once.
cd "$(dirname "$0")"

while ! grep -q "errored (of" sweep-background-l6.log 2>/dev/null; do sleep 20; done
cp sweep-results.jsonl sweep-results-background-l6.jsonl

echo "=== species axis, level 20"
rm -f sweep-results.jsonl
node run.mjs --sweep --axis species --incremental --level 20 > sweep-species-l20.log 2>&1
cp sweep-results.jsonl sweep-results-species-l20.jsonl
tail -3 sweep-species-l20.log

echo "=== background/feat axis, level 20"
rm -f sweep-results.jsonl
node run.mjs --sweep --axis background --incremental --level 20 > sweep-background-l20.log 2>&1
cp sweep-results.jsonl sweep-results-background-l20.jsonl
tail -3 sweep-background-l20.log
