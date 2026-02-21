<div align="center">

# Seaquel

**A modern, open-source database client for desktop and web.**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Version](https://img.shields.io/github/v/release/webstonehq/seaquel)](https://github.com/webstonehq/seaquel/releases)
[![Try Demo](https://img.shields.io/badge/Try-Live%20Demo-brightgreen)](https://seaquel.app/demo)

![Seaquel Screenshot](https://seaquel.app/product-screenshot.png)

</div>

## Features

- **Multi-database support** — PostgreSQL, MySQL, MariaDB, SQLite, MSSQL, and DuckDB
- **SQL editor** — Syntax highlighting, formatting, parameter support, and Monaco-based editing
- **Schema browser** — Explore tables, columns, indexes, constraints, and more
- **EXPLAIN/ANALYZE visualizer** — Understand query plans with hot path detection
- **Entity Relationship Diagrams** — Auto-generated ERDs with PNG/SVG export
- **Database statistics** — Dashboard with table sizes, row counts, and index usage
- **Visual query builder** — Drag-and-drop canvas for building queries without SQL
- **Data visualization** — Bar, line, pie, and scatter charts from query results
- **Inline result editing** — INSERT, UPDATE, and DELETE rows directly from the results table
- **CSV/JSON export** — Export query results to CSV or JSON
- **Query sharing** — Share queries via Git repositories
- **AI assistant** — Get help writing and understanding SQL queries
- **SQL learning sandbox** — Interactive challenges to practice SQL
- **SSH tunneling** — Connect securely through SSH tunnels
- **Connection import** — Import connections from DBeaver and TablePlus
- **Multi-project** — Organize connections and queries across projects
- **Themes** — Light and dark modes with a built-in theme editor
- **Internationalization** — Available in English, Spanish, German, French, Arabic, and Korean
- **Auto-updates** — Stay current with automatic update notifications
- **Command palette** — Quick access to all actions via keyboard

## Database Support

| Feature | PostgreSQL | MySQL | MariaDB | SQLite | MSSQL | DuckDB |
|---|:---:|:---:|:---:|:---:|:---:|:---:|
| Connect & query | :white_check_mark: | :white_check_mark: | :white_check_mark: | :white_check_mark: | :white_check_mark: | :white_check_mark: |
| Schema browser | :white_check_mark: | :white_check_mark: | :white_check_mark: | :white_check_mark: | :white_check_mark: | :white_check_mark: |
| EXPLAIN visualizer | :white_check_mark: | :white_check_mark: | :white_check_mark: | :white_check_mark: | :white_check_mark: | :white_check_mark: |
| ERD generation | :white_check_mark: | :white_check_mark: | :white_check_mark: | :white_check_mark: | :white_check_mark: | :white_check_mark: |
| Inline editing | :white_check_mark: | :white_check_mark: | :white_check_mark: | :white_check_mark: | :white_check_mark: | :white_check_mark: |
| Statistics dashboard | :white_check_mark: | :white_check_mark: | :white_check_mark: | :white_check_mark: | :white_check_mark: | :white_check_mark: |

## Installation

Download the latest release for your platform from [GitHub Releases](https://github.com/webstonehq/seaquel/releases).

| Platform | Architectures |
|---|---|
| macOS | Intel (x86_64), Apple Silicon (ARM64) |
| Linux | x86_64, ARM64 |
| Windows | x86_64, ARM64 |

Want to try it first? Check out the [browser demo](https://seaquel.app/demo) (powered by DuckDB WASM).

## Development

### Prerequisites

Use [mise](https://mise.jdx.dev/) to install the required toolchain:

```bash
mise install
```

This installs Node.js and Rust as defined in `mise.toml`.

### Setup

```bash
git clone https://github.com/webstonehq/seaquel.git
cd seaquel
npm install
```

### Commands

```bash
npm run tauri dev       # Start development (frontend + Tauri)
npm run tauri build     # Build production app
npm run check           # Type checking
npm run check:watch     # Type checking (watch mode)
```

## Tech Stack

- [Tauri 2](https://v2.tauri.app/) — Native app shell with Rust backend
- [SvelteKit 5](https://svelte.dev/docs/kit) — App framework
- [Svelte 5](https://svelte.dev/) — UI with runes-based reactivity
- [TypeScript](https://www.typescriptlang.org/) — Type safety
- [Tailwind CSS v4](https://tailwindcss.com/) — Styling
- [Rust](https://www.rust-lang.org/) — Backend plugins and system integration

## Community

- [Discord](https://seaquel.app/discord) — Chat, ask questions, share feedback
- [GitHub Issues](https://github.com/webstonehq/seaquel/issues) — Bug reports and feature requests

## Contributing

Contributions are welcome! Check the [open issues](https://github.com/webstonehq/seaquel/issues) to find something to work on, or open a new issue to propose a change.

## License

[MIT](LICENSE)
