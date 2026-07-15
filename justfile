# Install HailyKit from local source for a provider (default: crush)
install provider='crush' *args='':
    bun run ./scripts/install-from-source.mjs {{ provider }} {{ args }}
