# Changelog

All notable changes to this plugin are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-10-28

### Added

- Row-menu entries on every sidebar task: **Move to another space…** and **Delete task…**.
- Host routes under `/x-session-actions` for listing workspaces, moving a task,
  and deleting a task into `~/.dsh/trash/sessions`.
- Session-header `cwd` rewrite that preserves every later Zstandard frame byte-for-byte.
- Workspace registry detach/attach so a moved task lands in the target space immediately.
- Best-effort removal from the SQLite search index on delete.
