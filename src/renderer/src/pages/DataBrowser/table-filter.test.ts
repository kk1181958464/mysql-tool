import { describe, expect, it } from 'vitest'
import { buildSimpleFilterWhere, getDefaultSimpleFilterGroup } from './table-filter'
import { parseClipboardGrid } from './table-clipboard'

describe('table filter helpers', () => {
  it('quotes column names when building a simple filter', () => {
    const group = getDefaultSimpleFilterGroup()
    group.children = [{ id: '1', type: 'condition', column: 'na`me', operator: '=', value: "a'b", secondValue: '' }]
    expect(buildSimpleFilterWhere(group, () => 'varchar')).toBe("`na``me` = 'a\\'b'")
  })

  it('escapes backslashes so values cannot break out of the string literal', () => {
    const group = getDefaultSimpleFilterGroup()
    group.children = [{ id: '1', type: 'condition', column: 'c', operator: '=', value: "\\' OR 1=1 -- ", secondValue: '' }]
    expect(buildSimpleFilterWhere(group, () => 'varchar')).toBe("`c` = '\\\\\\' OR 1=1 --'")
  })
})

describe('clipboard grid parser', () => {
  it('keeps quoted tabs and newlines inside a cell', () => {
    expect(parseClipboardGrid('a\t"b\tb"\n"c\n"\td')).toEqual([['a', 'b\tb'], ['c\n', 'd']])
  })
})
