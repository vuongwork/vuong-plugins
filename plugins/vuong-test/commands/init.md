---
description: Cài vuong-test cho project (lần đầu) hoặc cho máy này sau khi clone — test.config.json, đường dẫn riêng máy (test.config.local.json), spec, môi trường
argument-hint: "[thư mục repo]"
---

Use the `vuong-test` skill and do only its step "0. Setup" for the repo at `$ARGUMENTS` (empty: the current
project root). Run init even when `test.config.json` already exists: it never overwrites, and it creates this
machine's `test.config.local.json`. Then run the config check from that step and ask the user for each missing
value. Stop after setup; do not start a test scope.
