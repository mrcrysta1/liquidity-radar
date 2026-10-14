// Pine Script (v5 subset) — lexer and parser, ported from the Pro terminal
// (pro-terminal/src/core/pine/parser.ts).
//
// Supports: indicator()/study(), var/varip, =, :=, += -= *= /=, tuples
// [a, b] = f(), if / else if / else, for … to … by, while, user functions
// (single-line `f(x) => expr` and multi-line), ternary, and/or/not,
// comparisons, arithmetic, history `x[1]`, named args, `//` comments, line
// continuation, dotted namespaces (ta.sma, input.int, color.red, math.max)
// and #RRGGBB(AA) colour literals.
//
// Kept free of runtime imports from the app so the engine tests can load it
// straight under Node (type stripping only — no parameter properties/enums).

export type TokKind = 'num' | 'str' | 'id' | 'op' | 'nl' | 'indent' | 'dedent' | 'eof'
export interface Tok {
  t: TokKind
  v: string
  line: number
  col: number
}

const OPS = [
  '==',
  '!=',
  '<=',
  '>=',
  ':=',
  '=>',
  '+=',
  '-=',
  '*=',
  '/=',
  '+',
  '-',
  '*',
  '/',
  '%',
  '<',
  '>',
  '=',
  '(',
  ')',
  '[',
  ']',
  ',',
  '?',
  ':',
]

/** A compile or runtime error, located when the position is known. */
export class PineError extends Error {
  line?: number
  col?: number
  constructor(msg: string, line?: number, col?: number) {
    super(line ? `Line ${line}${col ? ', col ' + col : ''}: ${msg}` : msg)
    this.name = 'PineError'
    this.line = line
    this.col = col
  }
}

function inString(line: string, idx: number): boolean {
  let q: string | null = null
  for (let i = 0; i < idx; i++) {
    const c = line[i]
    if (q) {
      if (c === '\\') i++
      else if (c === q) q = null
    } else if (c === '"' || c === "'") q = c
  }
  return q !== null
}

export function lex(src: string): Tok[] {
  const lines = src.replace(/\r/g, '').split('\n')
  const out: Tok[] = []
  const indents = [0]
  let parenDepth = 0
  let contLine = false
  for (let ln = 0; ln < lines.length; ln++) {
    let line = lines[ln]
    const cm = line.indexOf('//')
    if (cm >= 0 && !inString(line, cm)) line = line.slice(0, cm)
    if (!line.trim()) continue
    const lead = line.match(/^\s*/)![0]
    const ind = lead.replace(/\t/g, '    ').length
    const L = ln + 1
    const top = indents[indents.length - 1]
    if (
      parenDepth === 0 &&
      !contLine &&
      ind > top &&
      (ind - top) % 4 !== 0 &&
      out.at(-1)?.t === 'nl'
    ) {
      // Pine's line wrapping: a line indented by a non-multiple of four
      // continues the previous one.
      out.pop()
    } else if (parenDepth === 0 && !contLine) {
      if (ind > top) {
        indents.push(ind)
        out.push({ t: 'indent', v: '', line: L, col: 1 })
      } else
        while (ind < indents[indents.length - 1]) {
          indents.pop()
          out.push({ t: 'dedent', v: '', line: L, col: 1 })
        }
      if (ind !== indents[indents.length - 1])
        throw new PineError('Inconsistent indentation', L, ind + 1)
    }
    const s = line
    let i = lead.length
    while (i < s.length) {
      const ch = s[i]
      const col = i + 1
      if (ch === ' ' || ch === '\t') {
        i++
        continue
      }
      if (/[0-9]/.test(ch) || (ch === '.' && /[0-9]/.test(s[i + 1] ?? ''))) {
        const m = /^\d*\.?\d+(e[+-]?\d+)?|^\d+\.?/i.exec(s.slice(i))!
        out.push({ t: 'num', v: m[0], line: L, col })
        i += m[0].length
        continue
      }
      if (ch === '"' || ch === "'") {
        let j = i + 1
        let v = ''
        while (j < s.length && s[j] !== ch) {
          if (s[j] === '\\') {
            v += s[j + 1] ?? ''
            j += 2
          } else v += s[j++]
        }
        if (j >= s.length) throw new PineError('Unterminated string', L, col)
        out.push({ t: 'str', v, line: L, col })
        i = j + 1
        continue
      }
      if (ch === '#') {
        const m = /^#([0-9a-f]{8}|[0-9a-f]{6})\b/i.exec(s.slice(i))
        if (!m) throw new PineError(`Bad colour literal`, L, col)
        out.push({ t: 'str', v: m[0], line: L, col })
        i += m[0].length
        continue
      }
      if (/[A-Za-z_]/.test(ch)) {
        const m = /^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)*/.exec(s.slice(i))!
        out.push({ t: 'id', v: m[0], line: L, col })
        i += m[0].length
        continue
      }
      const op = OPS.find((o) => s.startsWith(o, i))
      if (!op) throw new PineError(`Unexpected character '${ch}'`, L, col)
      if (op === '(' || op === '[') parenDepth++
      if (op === ')' || op === ']') parenDepth = Math.max(0, parenDepth - 1)
      out.push({ t: 'op', v: op, line: L, col })
      i += op.length
    }
    const trimmed = s.trim()
    const last = out[out.length - 1]
    contLine =
      parenDepth > 0 ||
      (/[+\-*/%,?:=<>]$/.test(trimmed) && !trimmed.endsWith('=>')) ||
      (last?.t === 'id' && ['and', 'or', 'not'].includes(last.v))
    if (!contLine) out.push({ t: 'nl', v: '', line: L, col: s.length + 1 })
  }
  const end = lines.length
  while (indents.length > 1) {
    indents.pop()
    out.push({ t: 'dedent', v: '', line: end, col: 1 })
  }
  out.push({ t: 'eof', v: '', line: end, col: 1 })
  return out
}

// ---- AST ----
export type Expr =
  | { k: 'num'; v: number }
  | { k: 'str'; v: string }
  | { k: 'id'; v: string; line: number; col: number }
  | { k: 'un'; op: string; e: Expr }
  | { k: 'bin'; op: string; l: Expr; r: Expr }
  | { k: 'tern'; c: Expr; a: Expr; b: Expr }
  | {
      k: 'call'
      f: string
      args: Expr[]
      named: Record<string, Expr>
      id: number
      line: number
      col: number
    }
  | { k: 'idx'; e: Expr; i: Expr; id: number }
  | { k: 'tuple'; items: Expr[] }
export type Stmt =
  | { k: 'assign'; name: string; e: Expr; mode: 'var' | 'varip' | 'let' | 'reassign'; line: number }
  | { k: 'tassign'; names: string[]; e: Expr; mode: 'var' | 'let'; line: number }
  | { k: 'expr'; e: Expr; line: number }
  | { k: 'if'; branches: Array<{ c: Expr | null; body: Stmt[] }>; line: number }
  | { k: 'for'; v: string; from: Expr; to: Expr; step?: Expr; body: Stmt[]; line: number }
  | { k: 'while'; c: Expr; body: Stmt[]; line: number }
  | { k: 'fn'; name: string; params: string[]; body: Stmt[]; line: number }

const TYPE_NAMES = [
  'float',
  'int',
  'bool',
  'string',
  'color',
  'series',
  'simple',
  'const',
  'input',
  'line',
  'label',
]
const isTypeName = (v: string) => TYPE_NAMES.includes(v)

export function parse(src: string): Stmt[] {
  const toks = lex(src)
  let p = 0
  let nodeId = 0
  const peek = () => toks[p]
  const next = () => toks[p++]
  const is = (t: TokKind, v?: string) => peek().t === t && (v === undefined || peek().v === v)
  const at = (k: number) => toks[Math.min(p + k, toks.length - 1)]
  const fail = (msg: string, tok = peek()): never => {
    throw new PineError(msg, tok.line, tok.col)
  }
  const describe = (tok: Tok) =>
    tok.t === 'nl' ? 'end of line' : tok.t === 'eof' ? 'end of script' : `'${tok.v || tok.t}'`
  const expect = (t: TokKind, v?: string) => {
    if (!is(t, v)) fail(`Expected ${v ?? t} but found ${describe(peek())}`)
    return next()
  }
  const skipNl = () => {
    while (is('nl')) next()
  }

  function block(): Stmt[] {
    if (is('nl')) next()
    if (is('indent')) {
      next()
      const body: Stmt[] = []
      while (!is('dedent') && !is('eof')) {
        skipNl()
        if (is('dedent') || is('eof')) break
        body.push(statement())
      }
      if (is('dedent')) next()
      return body
    }
    if (is('dedent') || is('eof')) fail('Expected an indented block')
    return [statement()]
  }

  function names(): string[] {
    next() // [
    const out: string[] = []
    while (!is('op', ']')) {
      out.push(expect('id').v)
      if (is('op', ',')) next()
      else if (!is('op', ']')) fail(`Expected ',' or ']' but found ${describe(peek())}`)
    }
    next()
    return out
  }

  function statement(): Stmt {
    const line = peek().line
    if (is('id', 'if')) {
      next()
      const branches: Array<{ c: Expr | null; body: Stmt[] }> = [{ c: expr(), body: block() }]
      for (;;) {
        const save = p
        skipNl()
        if (is('id', 'else')) {
          next()
          if (is('id', 'if')) {
            next()
            branches.push({ c: expr(), body: block() })
          } else {
            branches.push({ c: null, body: block() })
            break
          }
        } else {
          p = save
          break
        }
      }
      return { k: 'if', branches, line }
    }
    if (is('id', 'for')) {
      next()
      const v = expect('id').v
      expect('op', '=')
      const from = expr()
      expect('id', 'to')
      const to = expr()
      let step: Expr | undefined
      if (is('id', 'by')) {
        next()
        step = expr()
      }
      return { k: 'for', v, from, to, step, body: block(), line }
    }
    if (is('id', 'while')) {
      next()
      const c = expr()
      return { k: 'while', c, body: block(), line }
    }
    if (is('op', '[')) {
      const save = p
      try {
        const ns = names()
        if (is('op', '=')) {
          next()
          const e = expr()
          endStmt()
          return { k: 'tassign', names: ns, e, mode: 'let', line }
        }
      } catch (e) {
        /* not a destructure — parse as an expression below */
      }
      p = save
    }
    if (is('id', 'var') || is('id', 'varip')) {
      const mode = next().v as 'var' | 'varip'
      if (is('op', '[')) {
        const ns = names()
        expect('op', '=')
        const e = expr()
        endStmt()
        return { k: 'tassign', names: ns, e, mode: 'var', line }
      }
      if (isTypeName(peek().v) && at(1).t === 'id') next()
      const name = expect('id').v
      expect('op', '=')
      const e = expr()
      endStmt()
      return { k: 'assign', name, e, mode, line }
    }
    if (
      is('id') &&
      isTypeName(peek().v) &&
      at(1).t === 'id' &&
      at(2).t === 'op' &&
      at(2).v === '='
    ) {
      next()
      const name = next().v
      next()
      const e = expr()
      endStmt()
      return { k: 'assign', name, e, mode: 'let', line }
    }
    if (is('id') && at(1).t === 'op') {
      const op = at(1).v
      if (op === '=' || op === ':=') {
        const name = next().v
        next()
        const e = expr()
        endStmt()
        return { k: 'assign', name, e, mode: op === '=' ? 'let' : 'reassign', line }
      }
      if (op === '+=' || op === '-=' || op === '*=' || op === '/=') {
        const t = next()
        next()
        const r = expr()
        endStmt()
        const l: Expr = { k: 'id', v: t.v, line: t.line, col: t.col }
        return { k: 'assign', name: t.v, e: { k: 'bin', op: op[0], l, r }, mode: 'reassign', line }
      }
    }
    // function definition: name(params) =>
    if (is('id') && at(1).t === 'op' && at(1).v === '(') {
      const save = p
      const name = next().v
      next()
      const params: string[] = []
      let ok = true
      while (!is('op', ')')) {
        if (is('id')) {
          if (isTypeName(peek().v) && at(1).t === 'id') next()
          params.push(next().v)
          if (is('op', '=')) {
            next()
            expr()
          }
        } else {
          ok = false
          break
        }
        if (is('op', ',')) next()
        else if (!is('op', ')')) {
          ok = false
          break
        }
      }
      if (ok && is('op', ')') && at(1).t === 'op' && at(1).v === '=>') {
        next()
        next()
        const body = block()
        return { k: 'fn', name, params, body, line }
      }
      p = save
    }
    const e = expr()
    endStmt()
    return { k: 'expr', e, line }
  }

  function endStmt() {
    if (is('nl')) next()
    else if (!is('dedent') && !is('eof')) fail(`Unexpected ${describe(peek())}`)
  }

  function expr(): Expr {
    return ternary()
  }
  function ternary(): Expr {
    const c = or()
    if (is('op', '?')) {
      next()
      const a = ternary()
      expect('op', ':')
      const b = ternary()
      return { k: 'tern', c, a, b }
    }
    return c
  }
  function or(): Expr {
    let l = and()
    while (is('id', 'or')) {
      next()
      l = { k: 'bin', op: 'or', l, r: and() }
    }
    return l
  }
  function and(): Expr {
    let l = not()
    while (is('id', 'and')) {
      next()
      l = { k: 'bin', op: 'and', l, r: not() }
    }
    return l
  }
  function not(): Expr {
    if (is('id', 'not')) {
      next()
      return { k: 'un', op: 'not', e: not() }
    }
    return cmp()
  }
  function cmp(): Expr {
    let l = add()
    while (is('op') && ['==', '!=', '<', '>', '<=', '>='].includes(peek().v)) {
      const op = next().v
      l = { k: 'bin', op, l, r: add() }
    }
    return l
  }
  function add(): Expr {
    let l = mul()
    while (is('op', '+') || is('op', '-')) {
      const op = next().v
      l = { k: 'bin', op, l, r: mul() }
    }
    return l
  }
  function mul(): Expr {
    let l = unary()
    while (is('op', '*') || is('op', '/') || is('op', '%')) {
      const op = next().v
      l = { k: 'bin', op, l, r: unary() }
    }
    return l
  }
  function unary(): Expr {
    if (is('op', '-')) {
      next()
      return { k: 'un', op: '-', e: unary() }
    }
    if (is('op', '+')) {
      next()
      return unary()
    }
    return postfix()
  }
  function postfix(): Expr {
    let e = primary()
    while (is('op', '[')) {
      next()
      const i = expr()
      expect('op', ']')
      e = { k: 'idx', e, i, id: nodeId++ }
    }
    return e
  }
  function primary(): Expr {
    const t = peek()
    if (t.t === 'num') {
      next()
      return { k: 'num', v: parseFloat(t.v) }
    }
    if (t.t === 'str') {
      next()
      return { k: 'str', v: t.v }
    }
    if (t.t === 'op' && t.v === '(') {
      next()
      const e = expr()
      expect('op', ')')
      return e
    }
    if (t.t === 'op' && t.v === '[') {
      next()
      const items: Expr[] = []
      while (!is('op', ']')) {
        items.push(expr())
        if (is('op', ',')) next()
        else if (!is('op', ']')) fail(`Expected ',' or ']' but found ${describe(peek())}`)
      }
      next()
      return { k: 'tuple', items }
    }
    if (t.t === 'id') {
      next()
      if (is('op', '(')) {
        next()
        const args: Expr[] = []
        const named: Record<string, Expr> = {}
        while (!is('op', ')')) {
          if (is('nl') || is('indent') || is('dedent')) {
            next()
            continue
          }
          if (is('eof')) fail(`Missing ')' for ${t.v}(`, t)
          if (is('id') && at(1).t === 'op' && at(1).v === '=') {
            const n = next().v
            next()
            named[n] = expr()
          } else args.push(expr())
          if (is('op', ',')) next()
          else if (is('eof')) fail(`Missing ')' for ${t.v}(`, t)
          else if (!is('op', ')')) fail(`Expected ',' or ')' but found ${describe(peek())}`)
        }
        next()
        return { k: 'call', f: t.v, args, named, id: nodeId++, line: t.line, col: t.col }
      }
      return { k: 'id', v: t.v, line: t.line, col: t.col }
    }
    return fail(`Unexpected ${describe(t)}`, t)
  }

  const prog: Stmt[] = []
  skipNl()
  while (!is('eof')) {
    skipNl()
    if (is('eof')) break
    if (is('indent')) fail('Unexpected indentation')
    if (is('dedent')) {
      next()
      continue
    }
    prog.push(statement())
  }
  return prog
}
