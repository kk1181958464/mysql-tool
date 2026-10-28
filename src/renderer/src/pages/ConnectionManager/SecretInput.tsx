import { Input } from '../../components/ui'
import { SAVED_SECRET_PLACEHOLDER } from '../../../../shared/constants'

interface Props {
  value: string
  onChange: (value: string) => void
  placeholder?: string
}

export function SecretInput({ value, onChange, placeholder }: Props) {
  const saved = value === SAVED_SECRET_PLACEHOLDER
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
      <Input
        type="password"
        value={saved ? '' : value}
        onChange={(e) => onChange(e.target.value === '' && saved ? SAVED_SECRET_PLACEHOLDER : e.target.value)}
        placeholder={saved ? '已保存，留空保持不变' : placeholder}
        style={{ flex: 1 }}
      />
      {saved && (
        <button type="button" className="ui-btn ui-btn-text ui-btn-small" onClick={() => onChange('')}>清除</button>
      )}
    </div>
  )
}
