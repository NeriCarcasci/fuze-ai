const RESET = '\x1b[0m'
const RED = '\x1b[31m'
const GREEN = '\x1b[32m'
const YELLOW = '\x1b[33m'
const BLUE = '\x1b[34m'
const DIM = '\x1b[2m'
const BOLD = '\x1b[1m'

export const log = {
  header: (msg: string) => console.log(`\n${BOLD}${BLUE}=== ${msg} ===${RESET}\n`),
  step: (n: number, msg: string) => console.log(`${DIM}[step ${n}]${RESET} ${msg}`),
  result: (msg: string) => console.log(`  ${GREEN}->${RESET} ${msg}`),
  guard: (msg: string) => console.log(`  ${RED}[guard]${RESET} ${msg}`),
  info: (msg: string) => console.log(`  ${DIM}${msg}${RESET}`),
  warn: (msg: string) => console.log(`  ${YELLOW}--${RESET} ${msg}`),
  error: (msg: string) => console.log(`  ${RED}!!${RESET} ${msg}`),
}
