// No shadcn Checkbox exists in this project's ui/ folder yet (only badge,
// button, card, input, label, role-picker, separator) — a plain native
// checkbox styled with accent-color matches the rest of the app's habit of
// not pulling in a component until it's needed twice.
export function ConfirmationCheckbox({
  id,
  checked,
  onChange,
  label,
}: {
  id: string
  checked: boolean
  onChange: (checked: boolean) => void
  label: string
}) {
  return (
    <label htmlFor={id} className="flex cursor-pointer items-start gap-3 rounded-lg border bg-muted/20 px-4 py-3">
      <input
        id={id}
        type="checkbox"
        checked={checked}
        onChange={e => onChange(e.target.checked)}
        className="mt-0.5 h-4 w-4 shrink-0 accent-primary"
      />
      <span className="text-sm leading-relaxed">{label}</span>
    </label>
  )
}
