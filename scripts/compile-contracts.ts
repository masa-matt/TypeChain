/* eslint-disable no-console */
import { execSync } from 'child_process'
import { mkdirSync, readdirSync, renameSync, rmdirSync, Stats as FsStats } from 'fs'
import { copySync, statSync } from 'fs-extra'
import { sync as globSync } from 'glob'
import { posix, resolve } from 'path'

import { bold, brightItalic } from './_common'

function main() {
  const files = findFiles()

  removeOutDir(files)
  generateABIs(files)
  renameOutputNames(files)
  copyTruffleV5(files)
  copyPrebuiltABIs(files)
}

main()

function findFiles() {
  const rootDir = resolve(__dirname, '..')
  const contractsDir = resolve(rootDir, 'contracts')
  const outDir = resolve(contractsDir, 'compiled')

  const solidityVersionDirs = readdirSync(contractsDir, { withFileTypes: true }).filter(
    (d) => d.isDirectory() && d.name.startsWith('v'),
  )

  const contracts = new Map(
    solidityVersionDirs.map((directory) => {
      const version = directory.name
      const path = resolve(contractsDir, version)
      const filePaths = globSync('./**/*.sol', { cwd: path })

      return [version, filePaths]
    }),
  )

  const prebuiltAbis = globSync('**/*.json', { cwd: contractsDir })

  return {
    rootDir,
    contractsDir,
    outDir,
    contracts,
    prebuiltAbis,
  }
}

type Files = ReturnType<typeof findFiles>

function removeOutDir({ outDir }: Files) {
  console.log(bold('Cleaning up contracts/abis'))

  try {
    rmdirSync(outDir, { recursive: true })
  } catch (e: any) {
    if (e.code !== 'ENOENT') {
      throw e
    }
  }
}

function generateABIs({ rootDir, contracts, outDir }: Files) {
  console.log(bold('Generating ABIs'))

  for (const [dirName, filePaths] of contracts.entries()) {
    const semver = dirName.replace(/^v/, '^')
    const contractPaths = filePaths.map((s) => posix.join('contracts', dirName, s)).join(' ')

    console.log(bold(`Compiling ${filePaths.length} contracts with \`pnpm dlx solc@${semver}\``))

    execSync(
      `pnpm --package solc@${semver} dlx solcjs --abi ${contractPaths} --bin -o ./contracts/compiled/${dirName}`,
      {
        cwd: rootDir,
        stdio: ['ignore', 'ignore', 'inherit'],
      },
    )
  }
}

/**
 * Rename ugly names generated by solc to something human redable.
 */
function renameOutputNames({ outDir, contracts, contractsDir }: Files) {
  console.log(bold('Renaming ABIs'))

  for (const version of contracts.keys()) {
    const directory = resolve(outDir, version)
    const outputs = readdirSync(directory)

    const newNames: string[] = []
    for (const outputPath of outputs) {
      // The output file name looks like this:
      // > contracts_v0_8_9_Issue552_Reproduction_sol_Issue552_Observer.abi
      // > |--------------| |-------------------|     |---------------|
      // >     dir name           file name             contract name
      const DIRECTORY_PREFIX = `contracts_${version}_`
      const relativePath = outputPath.slice(DIRECTORY_PREFIX.length)
      let filePath: string, contractName: string, extension: string
      ;[filePath, contractName] = relativePath.split('_sol_')
      ;[contractName, extension] = contractName.split('.')

      const contractsRootDir = `${contractsDir}/${version}`
      filePath = recoverDirectories(contractsRootDir, filePath)

      const newName = `${filePath}/${contractName}.${extension}`

      newNames.push(newName)
      mkdirSync(resolve(directory, filePath), { recursive: true })
      renameSync(resolve(directory, outputPath), resolve(directory, newName))
    }

    console.log(
      `Renamed ${bold(newNames.length)} files in ${bold(version)}:` +
        brightItalic(newNames.reduce((a, v, i) => (i % 2 === 0 ? a + '\n' + v : a + ' ' + v), '')),
    )
  }
}

function copyTruffleV5({ rootDir, contractsDir }: Files) {
  console.log(bold('Copy truffle-v5 contracts'))

  const truffleV5ContractsDir = resolve(rootDir, 'packages/target-truffle-v5-test/contracts')

  // TODO: Truffle config doesn't allow configuring multiple versions
  const versions = ['v0.6.4']
  for (const version of versions) {
    copySync(resolve(contractsDir, version), resolve(truffleV5ContractsDir, version))
  }
}

function copyPrebuiltABIs({ prebuiltAbis, outDir, contractsDir }: Files) {
  for (const filepath of prebuiltAbis) {
    copySync(resolve(contractsDir, filepath), resolve(outDir, filepath.replace('.json', '.abi')), { recursive: true })
  }
}

function recoverDirectories(cwd: string, path: string) {
  let res = './'
  let segments = path.split('_')
  let segment: string

  let i = 0
  while (segments.length && i++ < 5) {
    ;[segment, ...segments] = segments

    let isDirectory = false
    try {
      isDirectory = statSync(resolve(cwd, res, segment)).isDirectory()
    } catch {}

    if (isDirectory) res += segment + '/'
    else {
      if (segments.length) segments[0] = segment + '_' + segments[0]
      else return res + segment
    }
  }

  throw new Error('unexpected exit')
}
