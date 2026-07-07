/**
 * Shared tokenizer for the schema (`.schema`) and instance (`.instance`) DSLs.
 *
 * The two DSLs share a lexical grammar: C-style comments, brace/bracket/paren
 * grouping, identifiers, `::`-qualified type names, string/number literals,
 * and `!`-prefixed CloudFormation intrinsics. The parsers layer their own
 * grammar on top of this common token stream.
 */

export type TokenType =
  | 'ident' // [A-Za-z_][A-Za-z0-9_]*
  | 'string' // "..."
  | 'number' // 42, 3.14, -1
  | 'punct' // one of the punctuation values below
  | 'bang' // '!' (start of an intrinsic)
  | 'eof';

/** Multi- and single-character punctuation the lexer recognizes. */
export type Punct =
  | '{'
  | '}'
  | '['
  | ']'
  | '('
  | ')'
  | ':'
  | '::'
  | ','
  | '.'
  | '*'
  | '->'
  | '=';

export interface Token {
  type: TokenType;
  value: string;
  line: number;
  col: number;
}

export class LexError extends Error {
  constructor(message: string, public line: number, public col: number) {
    super(`${message} (line ${line}, col ${col})`);
    this.name = 'LexError';
  }
}

const IDENT_START = /[A-Za-z_]/;
const IDENT_PART = /[A-Za-z0-9_]/;
const DIGIT = /[0-9]/;

export function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  let line = 1;
  let col = 1;

  const peek = (offset = 0): string => source[i + offset] ?? '';

  const advance = (): string => {
    const ch = source[i++];
    if (ch === '\n') {
      line++;
      col = 1;
    } else {
      col++;
    }
    return ch;
  };

  while (i < source.length) {
    const ch = peek();

    // Whitespace
    if (ch === ' ' || ch === '\t' || ch === '\r' || ch === '\n') {
      advance();
      continue;
    }

    // Comments
    if (ch === '/' && peek(1) === '/') {
      while (i < source.length && peek() !== '\n') advance();
      continue;
    }
    if (ch === '/' && peek(1) === '*') {
      advance();
      advance();
      while (i < source.length && !(peek() === '*' && peek(1) === '/')) advance();
      if (i >= source.length) throw new LexError('Unterminated block comment', line, col);
      advance(); // *
      advance(); // /
      continue;
    }

    const startLine = line;
    const startCol = col;

    // Strings
    if (ch === '"') {
      advance();
      let str = '';
      while (i < source.length && peek() !== '"') {
        const c = advance();
        if (c === '\\') {
          const esc = advance();
          switch (esc) {
            case 'n': str += '\n'; break;
            case 't': str += '\t'; break;
            case 'r': str += '\r'; break;
            case '"': str += '"'; break;
            case '\\': str += '\\'; break;
            default: str += esc; break;
          }
        } else {
          str += c;
        }
      }
      if (i >= source.length) throw new LexError('Unterminated string', startLine, startCol);
      advance(); // closing "
      tokens.push({ type: 'string', value: str, line: startLine, col: startCol });
      continue;
    }

    // Numbers (including negative). A lone '-' not followed by a digit is only
    // valid as part of '->', handled below.
    if (DIGIT.test(ch) || (ch === '-' && DIGIT.test(peek(1)))) {
      let num = '';
      if (ch === '-') num += advance();
      while (i < source.length && DIGIT.test(peek())) num += advance();
      if (peek() === '.' && DIGIT.test(peek(1))) {
        num += advance(); // .
        while (i < source.length && DIGIT.test(peek())) num += advance();
      }
      tokens.push({ type: 'number', value: num, line: startLine, col: startCol });
      continue;
    }

    // Identifiers
    if (IDENT_START.test(ch)) {
      let id = '';
      while (i < source.length && IDENT_PART.test(peek())) id += advance();
      tokens.push({ type: 'ident', value: id, line: startLine, col: startCol });
      continue;
    }

    // Bang (intrinsic)
    if (ch === '!') {
      advance();
      tokens.push({ type: 'bang', value: '!', line: startLine, col: startCol });
      continue;
    }

    // Multi-character punctuation first
    if (ch === ':' && peek(1) === ':') {
      advance();
      advance();
      tokens.push({ type: 'punct', value: '::', line: startLine, col: startCol });
      continue;
    }
    if (ch === '-' && peek(1) === '>') {
      advance();
      advance();
      tokens.push({ type: 'punct', value: '->', line: startLine, col: startCol });
      continue;
    }

    // Single-character punctuation
    if ('{}[]():,.*='.includes(ch)) {
      advance();
      tokens.push({ type: 'punct', value: ch, line: startLine, col: startCol });
      continue;
    }

    throw new LexError(`Unexpected character '${ch}'`, startLine, startCol);
  }

  tokens.push({ type: 'eof', value: '', line, col });
  return tokens;
}

/**
 * A cursor over a token stream with the lookahead/consume helpers both
 * parsers need. Kept here so `schema-dsl.ts` and `instance-dsl.ts` share
 * identical error formatting.
 */
export class TokenStream {
  private pos = 0;

  constructor(private tokens: Token[]) {}

  peek(offset = 0): Token {
    return this.tokens[Math.min(this.pos + offset, this.tokens.length - 1)];
  }

  next(): Token {
    const t = this.tokens[this.pos];
    if (this.pos < this.tokens.length - 1) this.pos++;
    return t;
  }

  atEof(): boolean {
    return this.peek().type === 'eof';
  }

  /** True if the next token is the given punctuation. */
  isPunct(value: Punct, offset = 0): boolean {
    const t = this.peek(offset);
    return t.type === 'punct' && t.value === value;
  }

  /** True if the next token is an identifier equal to `word`. */
  isKeyword(word: string, offset = 0): boolean {
    const t = this.peek(offset);
    return t.type === 'ident' && t.value === word;
  }

  /** Consume the given punctuation or throw. */
  expectPunct(value: Punct): Token {
    if (!this.isPunct(value)) {
      throw this.error(`Expected '${value}'`);
    }
    return this.next();
  }

  /** Consume an identifier or throw. */
  expectIdent(): Token {
    const t = this.peek();
    if (t.type !== 'ident') {
      throw this.error('Expected an identifier');
    }
    return this.next();
  }

  /** Consume an identifier equal to `word` or throw. */
  expectKeyword(word: string): Token {
    if (!this.isKeyword(word)) {
      throw this.error(`Expected '${word}'`);
    }
    return this.next();
  }

  error(message: string): ParseError {
    const t = this.peek();
    const found = t.type === 'eof' ? 'end of input' : `'${t.value}'`;
    return new ParseError(`${message}, found ${found}`, t.line, t.col);
  }
}

export class ParseError extends Error {
  constructor(message: string, public line: number, public col: number) {
    super(`${message} (line ${line}, col ${col})`);
    this.name = 'ParseError';
  }
}
