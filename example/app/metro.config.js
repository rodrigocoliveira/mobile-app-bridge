const path = require('path')
const { getDefaultConfig } = require('expo/metro-config')

const projectRoot = __dirname
const libraryRoot = path.resolve(projectRoot, '../..')
const escape = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const config = getDefaultConfig(projectRoot)
config.watchFolders = [libraryRoot]
config.resolver.nodeModulesPaths = [path.resolve(projectRoot, 'node_modules')]
config.resolver.blockList = [new RegExp(`^${escape(path.join(libraryRoot, 'node_modules'))}\\/.*`)]

module.exports = config
