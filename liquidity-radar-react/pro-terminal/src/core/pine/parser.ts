/**
 * Pine Script (v5 subset) — lexer & parser.
 * Supports: indicator()/study(), var/varip, =, :=, tuples [a,b] = f(), if/else if/else, for, while, user functions
 * (single-line `f(x) => expr` and multi-line), ternary, and/or/not, comparisons, arithmetic, history `x[1]`,
 * named args, `//` comments, line continuations, dotted namespaces (ta.sma, input.int, color.red, math.max).
 */
export type Tok = { t: 'num' | 'str' | 'id' | 'op' | 'nl' | 'indent' | 'dedent' | 'eof'; v: string; line: number };

const OPS = ['==', '!=', '<=', '>=', ':=', '=>', '+', '-', '*', '/', '%', '<', '>', '=', '(', ')', '[', ']', ',', '?', ':'];

export function lex(src: string): Tok[] {
  const lines = src.replace(/\r/g, '').split('\n'); const out: Tok[] = []; const indents = [0]; let parenDepth = 0; let contLine = false;
  for (let ln = 0; ln < lines.length; ln++) {
    let line = lines[ln]; const cm = line.indexOf('//'); if (cm >= 0 && !inString(line, cm)) line = line.slice(0, cm);
    if (!line.trim()) continue;
    const ind = line.match(/^\s*/)![0].replace(/\t/g, '    ').length;
    if (parenDepth === 0 && !contLine) {
      if (ind > indents[indents.length - 1]) { indents.push(ind); out.push({ t: 'indent', v: '', line: ln + 1 }); }
      else while (ind < indents[indents.length - 1]) { indents.pop(); out.push({ t: 'dedent', v: '', line: ln + 1 }); }
    }
    let i = ind; const s = line;
    while (i < s.length) {
      const ch = s[i];
      if (ch === ' ' || ch === '\t') { i++; continue; }
      if (/[0-9]/.test(ch) || (ch === '.' && /[0-9]/.test(s[i + 1] ?? ''))) { const m = /^\d*\.?\d+(e[+-]?\d+)?|^\d+\.?/i.exec(s.slice(i))!; out.push({ t: 'num', v: m[0], line: ln + 1 }); i += m[0].length; continue; }
      if (ch === '"' || ch === "'") { let j = i + 1, v = ''; while (j < s.length && s[j] !== ch) { if (s[j] === '\\') { v += s[j + 1]; j += 2; } else v += s[j++]; } out.push({ t: 'str', v, line: ln + 1 }); i = j + 1; continue; }
      if (/[A-Za-z_]/.test(ch)) { const m = /^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)*/.exec(s.slice(i))!; out.push({ t: 'id', v: m[0], line: ln + 1 }); i += m[0].length; continue; }
      const op = OPS.find(o => s.startsWith(o, i)); if (!op) throw new PineError(`Unexpected character '${ch}'`, ln + 1);
      if (op === '(' || op === '[') parenDepth++; if (op === ')' || op === ']') parenDepth = Math.max(0, parenDepth - 1);
      out.push({ t: 'op', v: op, line: ln + 1 }); i += op.length;
    }
    const lastTok = out[out.length - 1]; const trimmed = s.trim();
    contLine = parenDepth > 0 || /[+\-*/%,?:=<>]$/.test(trimmed) && !trimmed.endsWith('=>') || (lastTok?.t === 'op' && ['and', 'or'].includes(lastTok.v));
    if (out[out.length - 1]?.t === 'id' && ['and', 'or', 'not'].includes(out[out.length - 1].v) ) contLine = true;
    if (!contLine) out.push({ t: 'nl', v: '', line: ln + 1 });
  }
  while (indents.length > 1) { indents.pop(); out.push({ t: 'dedent', v: '', line: lines.length }); }
  out.push({ t: 'eof', v: '', line: lines.length }); return out;
}
function inString(line: string, idx: number) { let q: string | null = null; for (let i = 0; i < idx; i++) { const c = line[i]; if (q) { if (c === '\\') i++; else if (c === q) q = null; } else if (c === '"' || c === "'") q = c; } return q !== null; }

export class PineError extends Error { constructor(msg: string, public line?: number) { super(line ? `Line ${line}: ${msg}` : msg); } }

// ---- AST ----
export type Expr =
  | { k: 'num'; v: number } | { k: 'str'; v: string } | { k: 'id'; v: string; line: number }
  | { k: 'un'; op: string; e: Expr } | { k: 'bin'; op: string; l: Expr; r: Expr } | { k: 'tern'; c: Expr; a: Expr; b: Expr }
  | { k: 'call'; f: string; args: Expr[]; named: Record<string, Expr>; id: number; line: number } | { k: 'idx'; e: Expr; i: Expr } | { k: 'tuple'; items: Expr[] };
export type Stmt =
  | { k: 'assign'; name: string; e: Expr; mode: 'var' | 'varip' | 'let' | 'reassign'; line: number }
  | { k: 'tassign'; names: string[]; e: Expr; mode: 'var' | 'let'; line: number }
  | { k: 'expr'; e: Expr; line: number }
  | { k: 'if'; branches: { c: Expr | null; body: Stmt[] }[]; line: number }
  | { k: 'for'; v: string; from: Expr; to: Expr; step?: Expr; body: Stmt[]; line: number }
  | { k: 'while'; c: Expr; body: Stmt[]; line: number }
  | { k: 'fn'; name: string; params: string[]; body: Stmt[]; line: number };

export function parse(src: string): Stmt[] {
  const toks = lex(src); let p = 0; let callId = 0;
  const peek = () => toks[p]; const next = () => toks[p++];
  const is = (t: Tok['t'], v?: string) => peek().t === t && (v === undefined || peek().v === v);
  const expect = (t: Tok['t'], v?: string) => { if (!is(t, v)) throw new PineError(`Expected ${v ?? t} but found '${peek().v || peek().t}'`, peek().line); return next(); };
  const skipNl = () => { while (is('nl')) next(); };

  function block(): Stmt[] {
    if (is('nl')) { next(); }
    if (is('indent')) { next(); const body: Stmt[] = []; while (!is('dedent') && !is('eof')) { skipNl(); if (is('dedent') || is('eof')) break; body.push(statement()); } if (is('dedent')) next(); return body; }
    return [statement()];
  }
  function statement(): Stmt {
    const line = peek().line;
    if (is('id', 'if')) { next(); const branches: { c: Expr | null; body: Stmt[] }[] = [{ c: expr(), body: block() }];
      for (;;) { const save = p; skipNl(); if (is('id', 'else')) { next(); if (is('id', 'if')) { next(); branches.push({ c: expr(), body: block() }); } else { branches.push({ c: null, body: block() }); break; } } else { p = save; break; } }
      return { k: 'if', branches, line }; }
    if (is('id', 'for')) { next(); const v = expect('id').v; expect('op', '='); const from = expr(); expect('id', 'to'); const to = expr(); let step: Expr | undefined; if (is('id', 'by')) { next(); step = expr(); } return { k: 'for', v, from, to, step, body: block(), line }; }
    if (is('id', 'while')) { next(); const c = expr(); return { k: 'while', c, body: block(), line }; }
    if (is('op', '[')) { // tuple destructure
      next(); const names: string[] = []; while (!is('op', ']')) { names.push(expect('id').v); if (is('op', ',')) next(); } next(); expect('op', '='); const e = expr(); endStmt(); return { k: 'tassign', names, e, mode: 'let', line }; }
    if (is('id', 'var') || is('id', 'varip')) { const mode = next().v as 'var' | 'varip'; if (is('op', '[')) { next(); const names: string[] = []; while (!is('op', ']')) { names.push(expect('id').v); if (is('op', ',')) next(); } next(); expect('op', '='); const e = expr(); endStmt(); return { k: 'tassign', names, e, mode: 'var', line }; }
      if (isTypeName(peek().v) && toks[p + 1].t === 'id') next(); const name = expect('id').v; expect('op', '='); const e = expr(); endStmt(); return { k: 'assign', name, e, mode, line }; }
    if (is('id') && isTypeName(peek().v) && toks[p + 1].t === 'id' && toks[p + 2].t === 'op' && toks[p + 2].v === '=') { next(); const name = next().v; next(); const e = expr(); endStmt(); return { k: 'assign', name, e, mode: 'let', line }; }
    if (is('id') && toks[p + 1].t === 'op' && (toks[p + 1].v === '=' || toks[p + 1].v === ':=')) { const name = next().v; const op = next().v; const e = expr(); endStmt(); return { k: 'assign', name, e, mode: op === '=' ? 'let' : 'reassign', line }; }
    // function definition: name(params) =>
    if (is('id') && toks[p + 1].t === 'op' && toks[p + 1].v === '(') { const save = p; const name = next().v; next(); const params: string[] = []; let ok = true;
      while (!is('op', ')')) { if (is('id')) { if (isTypeName(peek().v) && toks[p + 1].t === 'id') next(); params.push(next().v); if (is('op', '=')) { next(); expr(); } } else { ok = false; break; } if (is('op', ',')) next(); }
      if (ok && is('op', ')') && toks[p + 1].t === 'op' && toks[p + 1].v === '=>') { next(); next(); const body = block(); return { k: 'fn', name, params, body, line }; }
      p = save; }
    const e = expr(); endStmt(); return { k: 'expr', e, line };
  }
  function endStmt() { if (is('nl')) next(); else if (!is('dedent') && !is('eof')) throw new PineError(`Unexpected '${peek().v}'`, peek().line); }
  const isTypeName = (v: string) => ['float', 'int', 'bool', 'string', 'color', 'series', 'simple', 'const', 'input', 'line', 'label'].includes(v);

  function expr(): Expr { return ternary(); }
  function ternary(): Expr { const c = or(); if (is('op', '?')) { next(); const a = ternary(); expect('op', ':'); const b = ternary(); return { k: 'tern', c, a, b }; } return c; }
  function or(): Expr { let l = and(); while (is('id', 'or')) { next(); l = { k: 'bin', op: 'or', l, r: and() }; } return l; }
  function and(): Expr { let l = not(); while (is('id', 'and')) { next(); l = { k: 'bin', op: 'and', l, r: not() }; } return l; }
  function not(): Expr { if (is('id', 'not')) { next(); return { k: 'un', op: 'not', e: not() }; } return cmp(); }
  function cmp(): Expr { let l = add(); while (is('op') && ['==', '!=', '<', '>', '<=', '>='].includes(peek().v)) { const op = next().v; l = { k: 'bin', op, l, r: add() }; } return l; }
  function add(): Expr { let l = mul(); while (is('op', '+') || is('op', '-')) { const op = next().v; l = { k: 'bin', op, l, r: mul() }; } return l; }
  function mul(): Expr { let l = unary(); while (is('op', '*') || is('op', '/') || is('op', '%')) { const op = next().v; l = { k: 'bin', op, l, r: unary() }; } return l; }
  function unary(): Expr { if (is('op', '-')) { next(); return { k: 'un', op: '-', e: unary() }; } if (is('op', '+')) { next(); return unary(); } return postfix(); }
  function postfix(): Expr {
    let e = primary();
    for (;;) { if (is('op', '[')) { next(); const i = expr(); expect('op', ']'); e = { k: 'idx', e, i }; } else break; }
    return e;
  }
  function primary(): Expr {
    const t = peek();
    if (t.t === 'num') { next(); return { k: 'num', v: parseFloat(t.v) }; }
    if (t.t === 'str') { next(); return { k: 'str', v: t.v }; }
    if (t.t === 'op' && t.v === '(') { next(); const e = expr(); expect('op', ')'); return e; }
    if (t.t === 'op' && t.v === '[') { next(); const items: Expr[] = []; while (!is('op', ']')) { items.push(expr()); if (is('op', ',')) next(); } next(); return { k: 'tuple', items }; }
    if (t.t === 'id') {
      next();
      if (is('op', '(')) { next(); const args: Expr[] = []; const named: Record<string, Expr> = {};
        while (!is('op', ')')) { if (is('nl') || is('indent') || is('dedent')) { next(); continue; } if (is('id') && toks[p + 1].t === 'op' && toks[p + 1].v === '=') { const n = next().v; next(); named[n] = expr(); } else args.push(expr()); if (is('op', ',')) next(); }
        next(); return { k: 'call', f: t.v, args, named, id: callId++, line: t.line }; }
      return { k: 'id', v: t.v, line: t.line };
    }
    throw new PineError(`Unexpected '${t.v || t.t}'`, t.line);
  }
  const prog: Stmt[] = []; skipNl();
  while (!is('eof')) { skipNl(); if (is('eof')) break; if (is('dedent') || is('indent')) { next(); continue; } prog.push(statement()); }
  return prog;
}
