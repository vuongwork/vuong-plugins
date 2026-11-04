# Privacy Policy — vuong-test

_Last updated: 2026-11-04_

vuong-test is a Claude Code plugin made by vuongwork. This page explains what the plugin does with data.

## Summary

The plugin **does not collect, send, or store any data on servers run by the author**. Everything it creates stays on your own machine.

## What the plugin reads and writes

Everything below happens locally, in folders you choose:

- **Spec and source files.** The plugin reads them from your project to find test flows and write test cases.
- **Test output.** It writes `cases.md`, results, screenshots and HTML reports to a work folder in your project, by default `test-work/`.
- **Per-machine paths.** `test.config.local.json` (next to `test.config.json`, added to `.gitignore`) holds
  where shared folders are on your machine, such as the spec folder or a sibling repo. `core/config.mjs` reads
  it, or an environment variable with the same name, **only for names your project's config declares**. It runs
  read-only `git` queries to warn you if that file would be committed. These are paths and URLs, not secrets,
  and they are never sent anywhere.
- **Test accounts (optional).** If your tests need a login, `core/account.mjs` creates a file **outside your project** (for example `~/.<project>-test-account.sh`) with file mode 600. You fill in the values yourself. The plugin only checks that the variables are set and **never prints the values**.
- **Safety hook.** The `PreToolUse` hook reads each Bash command Claude is about to run, so it can block commands that destroy data. It does not save or send the command.

## Network access

The plugin has no telemetry, analytics or update checks. It makes network requests only when **you** run tests against an app or API you have configured, such as your local or test environment. Those requests go only to the addresses in your own configuration.

## Third parties

The plugin runs inside Claude Code. Your use of Claude Code, including what Claude reads from your project, is covered by [Anthropic's privacy policy](https://www.anthropic.com/legal/privacy), not by this page. Test tools you run with the plugin, such as Jest, Playwright or JUnit, follow their own policies.

## Removing data

To remove everything the plugin created, delete the `test-work/` folder and `test.config.local.json` in your project and any test account file you made. Uninstalling the plugin removes the plugin's own files.

## Contact

Questions or issues: [GitHub Issues](https://github.com/vuongwork/vuong-plugins/issues) or vuongpq.work@gmail.com.
