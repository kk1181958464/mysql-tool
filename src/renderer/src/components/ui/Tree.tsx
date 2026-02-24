import { useState, memo, useCallback } from 'react'
import './ui.css'

interface TreeNode {
  key: string
  title: React.ReactNode
  icon?: React.ReactNode
  children?: TreeNode[]
  isLeaf?: boolean
  disabled?: boolean
}

interface TreeProps {
  treeData: TreeNode[]
  selectedKeys?: string[]
  expandedKeys?: string[]
  defaultExpandedKeys?: string[]
  onSelect?: (keys: string[], info: { node: TreeNode }) => void
  onDoubleClick?: (node: TreeNode) => void
  onExpand?: (keys: string[]) => void
  onContextMenu?: (e: React.MouseEvent, node: TreeNode) => void
  className?: string
  style?: React.CSSProperties
}

interface TreeNodeItemProps {
  node: TreeNode
  level: number
  isExpanded: boolean
  isSelected: boolean
  onToggle: (key: string) => void
  onSelect: (node: TreeNode) => void
  onDoubleClick?: (node: TreeNode) => void
  onContextMenu?: (e: React.MouseEvent, node: TreeNode) => void
  expandedKeys: string[]
  selectedKeys: string[]
}

const TreeNodeItem = memo(function TreeNodeItem({
  node,
  level,
  isExpanded,
  isSelected,
  onToggle,
  onSelect,
  onDoubleClick,
  onContextMenu,
  expandedKeys,
  selectedKeys,
}: TreeNodeItemProps) {
  const hasChildren = node.children && node.children.length > 0

  const handleClick = useCallback(() => {
    if (node.disabled) return
    onSelect(node)
  }, [node, onSelect])

  const handleDblClick = useCallback(() => {
    if (node.disabled) return
    window.getSelection()?.removeAllRanges()
    if (hasChildren) onToggle(node.key)
    onDoubleClick?.(node)
  }, [node, hasChildren, onToggle, onDoubleClick])

  const handleArrowClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    if (node.disabled) return
    onToggle(node.key)
  }, [node, onToggle])

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    onContextMenu?.(e, node)
  }, [node, onContextMenu])

  return (
    <div className="ui-tree-node">
      <div
        className={`ui-tree-node-content ${isSelected ? 'selected' : ''} ${node.disabled ? 'disabled' : ''}`}
        style={{ paddingLeft: level * 16 + 8, userSelect: 'none' }}
        onClick={handleClick}
        onDoubleClick={handleDblClick}
        onContextMenu={handleContextMenu}
      >
        {hasChildren ? (
          <span className={`ui-tree-switcher ${isExpanded ? 'expanded' : ''}`} onClick={handleArrowClick}>▶</span>
        ) : (
          <span className="ui-tree-switcher-leaf" />
        )}
        {node.icon && <span className="ui-tree-icon">{node.icon}</span>}
        <span className="ui-tree-title">{node.title}</span>
      </div>
      {hasChildren && isExpanded && (
        <div className="ui-tree-children">
          {node.children!.map((child) => (
            <TreeNodeItem
              key={child.key}
              node={child}
              level={level + 1}
              isExpanded={expandedKeys.includes(child.key)}
              isSelected={selectedKeys.includes(child.key)}
              onToggle={onToggle}
              onSelect={onSelect}
              onDoubleClick={onDoubleClick}
              onContextMenu={onContextMenu}
              expandedKeys={expandedKeys}
              selectedKeys={selectedKeys}
            />
          ))}
        </div>
      )}
    </div>
  )
})

export function Tree({
  treeData,
  selectedKeys = [],
  expandedKeys: controlledExpandedKeys,
  defaultExpandedKeys = [],
  onSelect,
  onDoubleClick,
  onExpand,
  onContextMenu,
  className = '',
  style,
}: TreeProps) {
  const [innerExpandedKeys, setInnerExpandedKeys] = useState<string[]>(defaultExpandedKeys)
  const expandedKeys = controlledExpandedKeys ?? innerExpandedKeys

  const toggleExpand = useCallback((key: string) => {
    const newKeys = expandedKeys.includes(key)
      ? expandedKeys.filter((k) => k !== key)
      : [...expandedKeys, key]
    setInnerExpandedKeys(newKeys)
    onExpand?.(newKeys)
  }, [expandedKeys, onExpand])

  const handleSelect = useCallback((node: TreeNode) => {
    onSelect?.([node.key], { node })
  }, [onSelect])

  return (
    <div className={`ui-tree ${className}`} style={style}>
      {treeData.map((node) => (
        <TreeNodeItem
          key={node.key}
          node={node}
          level={0}
          isExpanded={expandedKeys.includes(node.key)}
          isSelected={selectedKeys.includes(node.key)}
          onToggle={toggleExpand}
          onSelect={handleSelect}
          onDoubleClick={onDoubleClick}
          onContextMenu={onContextMenu}
          expandedKeys={expandedKeys}
          selectedKeys={selectedKeys}
        />
      ))}
    </div>
  )
}
