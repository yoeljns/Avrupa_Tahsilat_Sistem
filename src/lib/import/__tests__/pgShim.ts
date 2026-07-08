import { Pool } from 'pg'
import type { SupabaseClient } from '@supabase/supabase-js'

// TEST ARACI: supabase-js'in bu projede kullanılan alt kümesini doğrudan
// PostgreSQL'e çeviren şim. Amaç: commit/recompute üretim kodunu yerel
// Postgres'te GERÇEK SQL ile uçtan uca koşturmak. Üretimde KULLANILMAZ.

type Row = Record<string, unknown>
interface Result {
  data: Row[] | Row | null
  error: { message: string } | null
}

class QueryBuilder implements PromiseLike<Result> {
  private table: string
  private pool: Pool
  private mode: 'select' | 'insert' | 'upsert' | 'update' | 'delete' = 'select'
  private columns = '*'
  private insertRows: Row[] = []
  private updateValues: Row = {}
  private conflictTarget: string | null = null
  private filters: Array<{ kind: 'eq' | 'neq' | 'in'; col: string; value: unknown }> = []
  private orderBy: Array<{ col: string; ascending: boolean }> = []
  private rangeFrom: number | null = null
  private rangeTo: number | null = null
  private single_: 'single' | 'maybe' | null = null
  private returning = false

  constructor(pool: Pool, table: string) {
    this.pool = pool
    this.table = table
  }

  select(cols?: string) {
    if (this.mode === 'insert' || this.mode === 'upsert' || this.mode === 'update') {
      this.returning = true
      this.columns = cols ?? '*'
      return this
    }
    this.mode = 'select'
    this.columns = cols ?? '*'
    return this
  }
  insert(rows: Row | Row[]) {
    this.mode = 'insert'
    this.insertRows = Array.isArray(rows) ? rows : [rows]
    return this
  }
  upsert(rows: Row | Row[], opts?: { onConflict?: string }) {
    this.mode = 'upsert'
    this.insertRows = Array.isArray(rows) ? rows : [rows]
    this.conflictTarget = opts?.onConflict ?? null
    return this
  }
  update(values: Row) {
    this.mode = 'update'
    this.updateValues = values
    return this
  }
  delete() {
    this.mode = 'delete'
    return this
  }
  eq(col: string, value: unknown) {
    this.filters.push({ kind: 'eq', col, value })
    return this
  }
  neq(col: string, value: unknown) {
    this.filters.push({ kind: 'neq', col, value })
    return this
  }
  in(col: string, value: unknown[]) {
    this.filters.push({ kind: 'in', col, value })
    return this
  }
  order(col: string, opts?: { ascending?: boolean }) {
    this.orderBy.push({ col, ascending: opts?.ascending ?? true })
    return this
  }
  range(from: number, to: number) {
    this.rangeFrom = from
    this.rangeTo = to
    return this
  }
  single() {
    this.single_ = 'single'
    return this
  }
  maybeSingle() {
    this.single_ = 'maybe'
    return this
  }

  private buildWhere(params: unknown[]): string {
    if (this.filters.length === 0) return ''
    const parts = this.filters.map((f) => {
      if (f.kind === 'in') {
        params.push(f.value)
        return `"${f.col}" = ANY($${params.length})`
      }
      if (f.value === null) return `"${f.col}" IS ${f.kind === 'eq' ? '' : 'NOT '}NULL`
      params.push(f.value)
      return `"${f.col}" ${f.kind === 'eq' ? '=' : '<>'} $${params.length}`
    })
    return ' WHERE ' + parts.join(' AND ')
  }

  private colList(): string {
    if (this.columns === '*') return '*'
    return this.columns
      .split(',')
      .map((c) => `"${c.trim()}"`)
      .join(', ')
  }

  private serialize(v: unknown): unknown {
    if (v !== null && typeof v === 'object' && !(v instanceof Date) && !Array.isArray(v)) return JSON.stringify(v)
    if (Array.isArray(v) && v.some((x) => typeof x === 'object' && x !== null)) return JSON.stringify(v)
    return v
  }

  async run(): Promise<Result> {
    try {
      const params: unknown[] = []
      let sql = ''

      if (this.mode === 'select') {
        sql = `SELECT ${this.colList()} FROM public."${this.table}"` + this.buildWhere(params)
        if (this.orderBy.length > 0) {
          sql += ' ORDER BY ' + this.orderBy.map((o) => `"${o.col}" ${o.ascending ? 'ASC' : 'DESC'}`).join(', ')
        }
        if (this.rangeFrom !== null && this.rangeTo !== null) {
          sql += ` OFFSET ${this.rangeFrom} LIMIT ${this.rangeTo - this.rangeFrom + 1}`
        }
      } else if (this.mode === 'insert' || this.mode === 'upsert') {
        if (this.insertRows.length === 0) return { data: [], error: null }
        const cols = Array.from(new Set(this.insertRows.flatMap((r) => Object.keys(r))))
        const valuesSql = this.insertRows
          .map((row) => {
            const ph = cols.map((c) => {
              params.push(this.serialize(row[c] === undefined ? null : row[c]))
              return `$${params.length}`
            })
            return `(${ph.join(', ')})`
          })
          .join(', ')
        sql = `INSERT INTO public."${this.table}" (${cols.map((c) => `"${c}"`).join(', ')}) VALUES ${valuesSql}`
        if (this.mode === 'upsert' && this.conflictTarget) {
          const conflictCols = this.conflictTarget.split(',').map((c) => c.trim())
          const updatable = cols.filter((c) => !conflictCols.includes(c))
          sql += ` ON CONFLICT (${conflictCols.map((c) => `"${c}"`).join(', ')}) DO UPDATE SET ${updatable
            .map((c) => `"${c}" = EXCLUDED."${c}"`)
            .join(', ')}`
        }
        if (this.returning) sql += ` RETURNING ${this.colList()}`
      } else if (this.mode === 'update') {
        const sets = Object.entries(this.updateValues).map(([c, v]) => {
          params.push(this.serialize(v === undefined ? null : v))
          return `"${c}" = $${params.length}`
        })
        sql = `UPDATE public."${this.table}" SET ${sets.join(', ')}` + this.buildWhere(params)
        if (this.returning) sql += ` RETURNING ${this.colList()}`
      } else {
        sql = `DELETE FROM public."${this.table}"` + this.buildWhere(params)
      }

      const res = await this.pool.query(sql, params)
      let data: Row[] | Row | null = res.rows ?? []
      if (this.single_) {
        if (this.single_ === 'single' && res.rows.length !== 1) {
          return { data: null, error: { message: `tek satır bekleniyordu, ${res.rows.length} geldi` } }
        }
        data = res.rows[0] ?? null
      }
      return { data, error: null }
    } catch (e) {
      return { data: null, error: { message: e instanceof Error ? e.message : String(e) } }
    }
  }

  then<T1 = Result, T2 = never>(
    onfulfilled?: ((value: Result) => T1 | PromiseLike<T1>) | null,
    onrejected?: ((reason: unknown) => T2 | PromiseLike<T2>) | null,
  ): PromiseLike<T1 | T2> {
    return this.run().then(onfulfilled, onrejected)
  }
}

export function createPgShim(pool: Pool): SupabaseClient {
  const shim = {
    from(table: string) {
      return new QueryBuilder(pool, table)
    },
    async rpc(fn: string, args: Record<string, unknown>) {
      try {
        const names = Object.keys(args)
        const params = names.map((n) => {
          const v = args[n]
          return v !== null && typeof v === 'object' ? JSON.stringify(v) : v
        })
        const ph = names.map((n, i) => `${n} := $${i + 1}${typeof args[n] === 'object' ? '::jsonb' : ''}`)
        const res = await pool.query(`SELECT public."${fn}"(${ph.join(', ')}) AS result`, params)
        return { data: res.rows[0]?.result ?? null, error: null }
      } catch (e) {
        return { data: null, error: { message: e instanceof Error ? e.message : String(e) } }
      }
    },
  }
  return shim as unknown as SupabaseClient
}
