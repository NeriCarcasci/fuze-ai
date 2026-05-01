#!/usr/bin/env node
import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

const root = process.cwd()
const pkgsDir = join(root, 'packages')
const workspaces = readdirSync(pkgsDir)
  .map((name) => ({ name, dir: join(pkgsDir, name) }))
  .filter(({ dir }) => existsSync(join(dir, 'package.json')))

const wsByPkgName = new Map()
const wsHasBuild = new Map()
for (const ws of workspaces) {
  const pkg = JSON.parse(readFileSync(join(ws.dir, 'package.json'), 'utf-8'))
  wsByPkgName.set(pkg.name, ws)
  wsHasBuild.set(ws.name, Boolean(pkg.scripts && pkg.scripts.build))
}

const manifests = new Map()
for (const ws of workspaces) {
  if (!wsHasBuild.get(ws.name)) continue
  const pkg = JSON.parse(readFileSync(join(ws.dir, 'package.json'), 'utf-8'))
  const internalDeps = new Set()
  for (const section of ['dependencies', 'peerDependencies']) {
    const deps = pkg[section] ?? {}
    for (const dep of Object.keys(deps)) {
      const target = wsByPkgName.get(dep)
      if (target && wsHasBuild.get(target.name)) internalDeps.add(target.name)
    }
  }
  manifests.set(ws.name, { dirName: ws.name, pkgName: pkg.name, internalDeps })
}

const built = new Set()
const order = []
const remaining = new Map(manifests)

while (remaining.size > 0) {
  const ready = []
  for (const [name, m] of remaining) {
    const unmet = [...m.internalDeps].filter((d) => !built.has(d))
    if (unmet.length === 0) ready.push(name)
  }
  if (ready.length === 0) {
    const stuck = [...remaining.keys()].join(', ')
    throw new Error(`build cycle or missing dep: cannot order [${stuck}]`)
  }
  ready.sort()
  for (const name of ready) {
    order.push(name)
    built.add(name)
    remaining.delete(name)
  }
}

console.log('build order:', order.join(' -> '))

for (const name of order) {
  const { pkgName } = manifests.get(name)
  console.log(`\n::group::build ${pkgName}`)
  const result = spawnSync('npm', ['run', 'build', '-w', pkgName], {
    cwd: root,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  })
  console.log('::endgroup::')
  if (result.status !== 0) {
    console.error(`build failed: ${pkgName} (exit ${result.status})`)
    process.exit(result.status ?? 1)
  }
}
