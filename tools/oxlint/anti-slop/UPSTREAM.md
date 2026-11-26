# anti-slop upstream

- Source: [dmmulroy/anti-slop](https://github.com/dmmulroy/anti-slop)
- Commit: `63dbb09f73438e550a6991dc6d778f979ffbf183`
- Assets tree: `54b50f11bed7f52ca1948f8802f4df591644762f`
- Copied from `skills/install-anti-slop/assets/anti-slop` via the upstream install script, plus the root `LICENSE`.
- Deviations: none.

## Rules disabled pending upstream fixes

- `anti-slop/no-unknown-type-aliases` has an upstream false positive. Caller type parameters leak into a separately declared alias. Re-enable after an upstream fix.
