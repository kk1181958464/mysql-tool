interface Props {
  label: string
  required?: boolean
  hint?: string
  span?: number
  children: React.ReactNode
}

export function FormField({ label, required, hint, span = 1, children }: Props) {
  return (
    <div className="cm-field" style={span > 1 ? { gridColumn: `span ${span}` } : undefined}>
      <label className="cm-label">
        {required && <span className="cm-required">*</span>}
        {label}
      </label>
      {children}
      {hint && <div className="cm-hint">{hint}</div>}
    </div>
  )
}

export function FormSection({ title, extra, columns = 2, children }: { title?: string; extra?: React.ReactNode; columns?: number; children: React.ReactNode }) {
  return (
    <section className="cm-section">
      {(title || extra) && (
        <div className="cm-section-head">
          {title && <span className="cm-section-title">{title}</span>}
          {extra}
        </div>
      )}
      <div className="cm-grid" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>{children}</div>
    </section>
  )
}
