const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// 1. Watch all files within the monorepo/pnpm structure
config.watchFolders = [__dirname];

// 2. Let Metro know where to resolve packages from
config.resolver.nodeModulesPaths = [
  require('path').resolve(__dirname, 'node_modules'),
];

module.exports = config;
