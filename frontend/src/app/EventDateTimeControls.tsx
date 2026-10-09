export function EventDateTimeControls({
  id,
  label,
  value,
  onChange,
  invalid = false,
  describedBy,
  step = 0.001,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  invalid?: boolean;
  describedBy?: string;
  step?: number;
}) {
  const [date = "", time = ""] = value.split("T");
  const update = (nextDate: string, nextTime: string) =>
    onChange(nextDate || nextTime ? `${nextDate}T${nextTime}` : "");
  return (
    <fieldset className="event-date-time">
      <legend>{label}</legend>
      <label htmlFor={id}>
        <span>Date</span>
        <input
          id={id}
          aria-label={`${label} date`}
          type="date"
          value={date}
          aria-invalid={invalid}
          aria-describedby={describedBy}
          onChange={(event) => update(event.target.value, time)}
        />
      </label>
      <label htmlFor={`${id}-time`}>
        <span>Time</span>
        <input
          id={`${id}-time`}
          aria-label={`${label} time`}
          type="time"
          step={step}
          value={time}
          aria-invalid={invalid}
          aria-describedby={describedBy}
          onChange={(event) => update(date, event.target.value)}
        />
      </label>
    </fieldset>
  );
}
