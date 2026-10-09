import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ComponentType,
} from "react";
import { CornerDownLeft, Search } from "lucide-react";

export interface Command {
  id: string;
  label: string;
  group: string;
  Icon: ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
  run: () => void;
}

/**
 * Keyboard-first jump list for the workspace. It only offers navigation the
 * workspace already exposes (sections, page links, authorized contexts); it
 * never adds capabilities or bypasses any server check.
 */
export function CommandPalette({
  commands,
  onClose,
}: {
  commands: Command[];
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const listId = useId();

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q
      ? commands.filter((c) =>
          `${c.label} ${c.group}`.toLowerCase().includes(q),
        )
      : commands;
  }, [commands, query]);

  useEffect(() => {
    const node = dialog.current;
    if (!node) return;
    if (typeof node.showModal === "function") node.showModal();
    else node.setAttribute("open", "");
    input.current?.focus();
    return () => {
      if (node.open && typeof node.close === "function") node.close();
    };
  }, []);

  useEffect(() => setActive(0), [query]);

  function choose(command: Command | undefined) {
    if (!command) return;
    onClose();
    command.run();
  }

  let lastGroup = "";
  return (
    <dialog
      ref={dialog}
      className="palette"
      aria-label="Quick actions"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === dialog.current) onClose();
      }}
    >
      <div className="palette-search">
        <Search aria-hidden className="size-4" />
        <input
          ref={input}
          role="combobox"
          aria-expanded="true"
          aria-controls={listId}
          aria-activedescendant={
            results[active] ? `${listId}-${results[active].id}` : undefined
          }
          aria-label="Search sections, pages and events"
          placeholder="Search sections, pages and events"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") {
              event.preventDefault();
              setActive((i) => Math.min(i + 1, results.length - 1));
            } else if (event.key === "ArrowUp") {
              event.preventDefault();
              setActive((i) => Math.max(i - 1, 0));
            } else if (event.key === "Enter") {
              event.preventDefault();
              choose(results[active]);
            }
          }}
        />
        <kbd>Esc</kbd>
      </div>
      <ul id={listId} role="listbox" className="palette-list">
        {results.length === 0 && (
          <li className="palette-empty" role="presentation">
            No matches.
          </li>
        )}
        {results.map((command, index) => {
          const header = command.group !== lastGroup ? command.group : null;
          lastGroup = command.group;
          return (
            <li key={command.id} role="presentation">
              {header && <p className="palette-group">{header}</p>}
              <div
                id={`${listId}-${command.id}`}
                role="option"
                aria-selected={index === active}
                className="palette-item"
                onMouseMove={() => setActive(index)}
                onClick={() => choose(command)}
              >
                <command.Icon aria-hidden className="size-4" />
                <span>{command.label}</span>
                {index === active && (
                  <CornerDownLeft
                    aria-hidden
                    className="palette-enter size-4"
                  />
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </dialog>
  );
}
