import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react'
import { useId, useRef, useState } from 'react'
import { Temporal } from '@js-temporal/polyfill'

const weekdays = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']

export function DateField({ label, name, initial, control }: {
  label: string; name: string; initial?: string; control: string
}) {
  const id = useId()
  const input = useRef<HTMLInputElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const [month, setMonth] = useState<Temporal.PlainDate>()
  const [selected, setSelected] = useState(initial)
  const today = Temporal.Now.plainDateISO()
  const first = month?.with({ day: 1 })
  const offset = first ? first.dayOfWeek % 7 : 0
  const title = first?.toLocaleString(undefined, { month: 'long', year: 'numeric' })

  function close() {
    setMonth(undefined)
    trigger.current?.focus()
  }

  return <div className="cl-date relative min-w-0" onKeyDown={event => {
    if (event.key === 'Escape' && month) {
      event.stopPropagation()
      close()
    }
  }} onBlur={event => {
    if (!event.currentTarget.contains(event.relatedTarget)) setMonth(undefined)
  }}>
    <label htmlFor={id}>{label}</label>
    <div className="relative">
      <input ref={input} id={id} className={control} name={name} type="date" defaultValue={initial} required
        onChange={event => setSelected(event.target.value)} />
      <button ref={trigger} type="button" className="cl-date-trigger" aria-label={'Open calendar for ' + label}
        aria-expanded={!!month} aria-controls={month ? id + '-calendar' : undefined}
        onClick={() => month ? close() : setMonth(input.current?.value ? Temporal.PlainDate.from(input.current.value) : today)}>
        <CalendarDays size={17} aria-hidden="true" />
      </button>
    </div>
    {first && <section id={id + '-calendar'} className="cl-calendar" aria-label={label + ' calendar'}>
      <div className="flex items-center justify-between gap-2">
        <button type="button" aria-label="Previous month" onClick={() => setMonth(first.subtract({ months: 1 }))}><ChevronLeft size={18} /></button>
        <span aria-live="polite" className="font-semibold">{title}</span>
        <button type="button" aria-label="Next month" onClick={() => setMonth(first.add({ months: 1 }))}><ChevronRight size={18} /></button>
      </div>
      <div className="mt-2 grid grid-cols-7 gap-1 text-center">
        {weekdays.map(day => <span key={day} className="text-sm text-muted-foreground">{day}</span>)}
        {Array.from({ length: offset }, (_, index) => <span key={'empty-' + index} />)}
        {Array.from({ length: first.daysInMonth }, (_, index) => {
          const day = first.with({ day: index + 1 })
          const value = day.toString()
          return <button key={value} type="button" aria-label={day.toLocaleString(undefined, { dateStyle: 'full' })}
            aria-pressed={value === selected} aria-current={value === today.toString() ? 'date' : undefined}
            onClick={() => {
              if (input.current) input.current.value = value
              setSelected(value)
              close()
            }}>{day.day}</button>
        })}
      </div>
    </section>}
  </div>
}
