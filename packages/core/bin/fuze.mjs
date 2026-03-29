#!/usr/bin/env node
/**
 * fuze-ai CLI entry point.
 * Routes subcommands to the appropriate package.
 */

const [,, subcommand, ...args] = process.argv

switch (subcommand) {
  case 'daemon': {
    try {
      // In workspace, @fuze-ai/daemon is a sibling package
      const { startDaemon } = await import('@fuze-ai/daemon')
      await startDaemon(args)
    } catch (err) {
      process.stderr.write(`fuze-ai: daemon package not found. Run 'npm install' in the monorepo root.\n`)
      process.exit(1)
    }
    break
  }
  default: {
    process.stderr.write(`fuze-ai: unknown subcommand '${subcommand ?? '(none)'}'

Usage:
  fuze-ai daemon [--port 4200] [--socket /tmp/fuze.sock] [--storage ./traces.db]
`)
    process.exit(1)
  }
}
