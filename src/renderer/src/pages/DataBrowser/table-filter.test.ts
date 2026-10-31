import { describe, expect, it } from 'vitest'
import { addConditionToGroup, appendConditionWithJoin, findCommonParent, groupFilterNodes, ungroupFilterNode, buildSimpleFilterWhere, getDefaultSimpleFilterGroup, removeFilterNode, toggleGroupJoin, wrapFilterNode, type SimpleFilterCondition, type SimpleFilterGroup } from './table-filter'
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

describe('filter tree editing', () => {
  const cond = (column: string, value: string): SimpleFilterCondition => ({ id: column, type: 'condition', column, operator: '=', value })
  const sql = (tree: SimpleFilterGroup) => buildSimpleFilterWhere(tree, () => 'varchar')
  const root = (join: 'AND' | 'OR', ...children: SimpleFilterGroup['children']): SimpleFilterGroup => ({ id: 'root', type: 'group', join, children })

  it('builds id = 1 AND (name = 3 OR age = 13) by wrapping', () => {
    const tree = wrapFilterNode(root('AND', cond('id', '1'), cond('name', '3')), 'name', cond('age', '13'))
    expect(sql(tree)).toBe("(`id` = '1' AND (`name` = '3' OR `age` = '13'))")
  })

  it('builds (id = 1 AND name = 3) OR age = 13', () => {
    const flat = addConditionToGroup(root('AND', cond('id', '1')), 'root', cond('age', '13'))
    expect(sql(addConditionToGroup(flat, 'root', cond('name', '3')))).toBe("(`id` = '1' AND `age` = '13' AND `name` = '3')")
    expect(sql(wrapFilterNode(root('OR', cond('id', '1'), cond('age', '13')), 'id', cond('name', '3')))).toBe("((`id` = '1' AND `name` = '3') OR `age` = '13')")
  })

  it('nests brackets inside brackets', () => {
    const a = wrapFilterNode(root('AND', cond('a', '1'), cond('b', '2')), 'b', cond('c', '3'))
    const b = wrapFilterNode(a, 'c', cond('d', '4'))
    expect(sql(b)).toBe("(`a` = '1' AND (`b` = '2' OR (`c` = '3' AND `d` = '4')))")
  })

  it('unwraps a bracket left with one condition', () => {
    const tree = wrapFilterNode(root('AND', cond('id', '1'), cond('name', '3')), 'name', cond('age', '13'))
    expect(sql(removeFilterNode(tree, 'age'))).toBe("(`id` = '1' AND `name` = '3')")
  })

  it('keeps brackets when any join is toggled', () => {
    const g1: SimpleFilterGroup = { id: 'g1', type: 'group', join: 'OR', children: [cond('id', '1'), cond('name', '2')] }
    const g2: SimpleFilterGroup = { id: 'g2', type: 'group', join: 'OR', children: [cond('type', '3'), cond('img', '4')] }
    const tree = root('AND', g1, g2)
    expect(sql(toggleGroupJoin(tree, 'root'))).toBe("((`id` = '1' OR `name` = '2') OR (`type` = '3' OR `img` = '4'))")
    expect(sql(toggleGroupJoin(tree, 'g1'))).toBe("((`id` = '1' AND `name` = '2') AND (`type` = '3' OR `img` = '4'))")
  })

  it('wraps the whole level when appending with a different join', () => {
    const g1: SimpleFilterGroup = { id: 'g1', type: 'group', join: 'OR', children: [cond('id', '1'), cond('name', '2')] }
    const g2: SimpleFilterGroup = { id: 'g2', type: 'group', join: 'OR', children: [cond('type', '3'), cond('img', '4')] }
    const tree = appendConditionWithJoin(root('AND', g1, g2), 'root', cond('x', '5'), 'OR')
    expect(sql(tree)).toBe("(((`id` = '1' OR `name` = '2') AND (`type` = '3' OR `img` = '4')) OR `x` = '5')")
    expect(sql(appendConditionWithJoin(tree, 'root', cond('y', '6'), 'OR'))).toBe("(((`id` = '1' OR `name` = '2') AND (`type` = '3' OR `img` = '4')) OR `x` = '5' OR `y` = '6')")
    expect(sql(appendConditionWithJoin(tree, 'root', cond('z', '7'), 'AND'))).toBe("((((`id` = '1' OR `name` = '2') AND (`type` = '3' OR `img` = '4')) OR `x` = '5') AND `z` = '7')")
  })

  it('appends with the chosen join inside a bracket and for a single condition', () => {
    const g1: SimpleFilterGroup = { id: 'g1', type: 'group', join: 'OR', children: [cond('a', '1'), cond('b', '2')] }
    expect(sql(appendConditionWithJoin(root('AND', cond('id', '1'), g1), 'g1', cond('c', '3'), 'AND'))).toBe("(`id` = '1' AND ((`a` = '1' OR `b` = '2') AND `c` = '3'))")
    expect(sql(appendConditionWithJoin(root('AND', cond('a', '1')), 'root', cond('b', '2'), 'OR'))).toBe("(`a` = '1' OR `b` = '2')")
  })

  it('groups two existing brackets so the outer join can differ', () => {
    const g1: SimpleFilterGroup = { id: 'g1', type: 'group', join: 'OR', children: [cond('id', '1'), cond('type', '2')] }
    const g2: SimpleFilterGroup = { id: 'g2', type: 'group', join: 'OR', children: [cond('name', '1'), cond('img', '1')] }
    const grouped = groupFilterNodes(root('AND', g1, g2, cond('video', '1')), ['g1', 'g2'])
    expect(sql(grouped)).toBe("(((`id` = '1' OR `type` = '2') AND (`name` = '1' OR `img` = '1')) AND `video` = '1')")
    expect(sql(toggleGroupJoin(grouped, 'root'))).toBe("(((`id` = '1' OR `type` = '2') AND (`name` = '1' OR `img` = '1')) OR `video` = '1')")
  })

  it('refuses to group items from different levels and can ungroup', () => {
    const g1: SimpleFilterGroup = { id: 'g1', type: 'group', join: 'OR', children: [cond('a', '1'), cond('b', '2')] }
    const tree = root('AND', g1, cond('c', '3'))
    expect(findCommonParent(tree, ['a', 'c'])).toBeNull()
    expect(groupFilterNodes(tree, ['a', 'c'])).toBe(tree)
    expect(sql(ungroupFilterNode(tree, 'g1'))).toBe("(`a` = '1' AND `b` = '2' AND `c` = '3')")
  })

  it('groups everything at the top level into one outer bracket', () => {
    const grouped = groupFilterNodes(root('OR', cond('a', '1'), cond('b', '2')), ['a', 'b'])
    expect(grouped.children).toHaveLength(1)
    expect(sql(appendConditionWithJoin(grouped, 'root', cond('c', '3'), 'AND'))).toBe("((`a` = '1' OR `b` = '2') AND `c` = '3')")
  })

  it('keeps a bracket around the only condition pair', () => {
    const tree = wrapFilterNode(root('AND', cond('a', '1')), 'a', cond('b', '2'))
    expect(tree.join).toBe('AND')
    expect(sql(addConditionToGroup(tree, 'root', cond('c', '3')))).toBe("((`a` = '1' OR `b` = '2') AND `c` = '3')")
  })
})
